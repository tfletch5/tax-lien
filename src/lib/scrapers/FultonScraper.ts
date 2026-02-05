import * as cheerio from "cheerio";
import axios from "axios";
import { BaseScraper, ScrapedTaxLien } from "./BaseScraper";
import { RealEstateService } from "@/lib/RealEstateService";
import { parsePdf } from "@/lib/utils/pdfParse";

export class FultonScraper extends BaseScraper {
  private enableEnrichment: boolean;
  private realEstateService: RealEstateService | null = null;

  constructor(countyId: number, countyName: string, enableEnrichment: boolean = true) {
    super(countyId, countyName);
    this.enableEnrichment = enableEnrichment;
    if (enableEnrichment) {
      try {
        this.realEstateService = new RealEstateService();
      } catch (error) {
        console.warn("RealEstateService initialization failed, enrichment disabled:", error);
        this.enableEnrichment = false;
      }
    }
  }

  async scrape(): Promise<ScrapedTaxLien[]> {
    try {
      console.log("Starting Fulton County tax lien scraping...");
      if (this.enableEnrichment) {
        console.log("⚠️ Enrichment during scraping is ENABLED - only properties with assessedImprovementValue > 0 will be saved");
      }

      const url = "https://fcsoga.org/tax-sales/";

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const $ = cheerio.load(response.data);
      const liens: ScrapedTaxLien[] = [];

      // Find all links and filter for Sheriff's Sale List PDFs
      // Pattern: links containing "Sheriff" and "Sale-List" or "Sale List"
      const allLinks = $("a")
        .map((i, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          const parentText = $(el).parent().text().trim();
          return { href, text, parentText };
        })
        .get();

      console.log(`Found ${allLinks.length} total links on the page`);

      // Filter for Sheriff's Sale List PDFs
      // Look for links with "Sheriff" and "Sale" in text or href
      const saleListPdfs = allLinks.filter((link) => {
        if (!link.href) return false;
        const hrefLower = link.href.toLowerCase();
        const textLower = (link.text + " " + link.parentText).toLowerCase();

        // Must be a PDF link
        const isPdf = hrefLower.includes(".pdf") || hrefLower.includes("/uploads/");
        
        // Must contain "sheriff" and "sale" (or "sale-list")
        const hasSheriff = textLower.includes("sheriff") || hrefLower.includes("sheriff");
        const hasSale = textLower.includes("sale") || hrefLower.includes("sale-list");

        return isPdf && hasSheriff && hasSale;
      });

      console.log(`Found ${saleListPdfs.length} Sheriff's Sale List PDF links`);

      // Process each PDF
      for (const pdfLink of saleListPdfs) {
        try {
          if (!pdfLink.href) continue;

          // Construct full URL
          let pdfUrl = pdfLink.href.startsWith("http")
            ? pdfLink.href
            : pdfLink.href.startsWith("/")
            ? `https://fcsoga.org${pdfLink.href}`
            : `https://fcsoga.org/${pdfLink.href}`;

          console.log(`Processing PDF: ${pdfLink.text || pdfLink.href}`);
          console.log(`PDF URL: ${pdfUrl}`);

          const pdfLiens = await this.parsePdf(pdfUrl);
          liens.push(...pdfLiens);
          console.log(`Extracted ${pdfLiens.length} liens from PDF: ${pdfLink.text || pdfLink.href}`);
        } catch (pdfError) {
          console.error(`Failed to process PDF ${pdfLink.text || pdfLink.href}:`, pdfError);
        }
      }

      console.log(`Found ${liens.length} total tax liens in Fulton County`);

      // Enrich and filter liens if enrichment is enabled
      let validLiens: ScrapedTaxLien[] = [];
      if (this.enableEnrichment && this.realEstateService) {
        console.log(`Enriching ${liens.length} liens to validate assessedImprovementValue...`);
        validLiens = await this.enrichAndFilterLiens(liens);
        console.log(`After enrichment filtering: ${validLiens.length} valid liens (${liens.length - validLiens.length} skipped)`);
      } else {
        validLiens = liens;
      }

      // Save to database
      await this.saveToDatabase(validLiens);

      // After saving, enrich the saved liens to populate properties and investment scores
      if (this.enableEnrichment && this.realEstateService && validLiens.length > 0) {
        console.log(`Enriching ${validLiens.length} saved liens to populate properties and investment scores...`);
        await this.enrichSavedLiens(validLiens);
      }

      return validLiens;
    } catch (error) {
      console.error("Error scraping Fulton County:", error);
      throw new Error(
        `Fulton scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Enrich each lien and filter out those with assessedImprovementValue = 0
   * Includes rate limiting to avoid API throttling
   */
  private async enrichAndFilterLiens(liens: ScrapedTaxLien[]): Promise<ScrapedTaxLien[]> {
    if (!this.realEstateService) {
      return liens;
    }

    const validLiens: ScrapedTaxLien[] = [];
    const rateLimitDelay = 200; // 200ms delay between API calls

    for (let i = 0; i < liens.length; i++) {
      const lien = liens[i];

      try {
        // Rate limiting: wait between requests
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));
        }

        // Build address string for fallback search
        const address = lien.property_address
          ? `${lien.property_address}${lien.city ? `, ${lien.city}` : ""}${lien.zip ? ` ${lien.zip}` : ""}`
          : undefined;

        console.log(`[${i + 1}/${liens.length}] Validating lien ${lien.parcel_id}...`);

        // Enrich property (validation only - doesn't save to DB)
        const enrichmentResult = await this.realEstateService.enrichPropertyByParcel(
          lien.parcel_id,
          address
        );

        if (enrichmentResult && enrichmentResult.isValid) {
          validLiens.push(lien);
          console.log(`✅ Lien ${lien.parcel_id} is valid and will be saved`);
        } else {
          console.log(`⚠️ Lien ${lien.parcel_id} skipped (assessedImprovementValue = 0 or enrichment failed)`);
        }
      } catch (error) {
        console.error(`Error validating lien ${lien.parcel_id}:`, error);
        console.log(`⚠️ Lien ${lien.parcel_id} skipped due to validation error`);
      }
    }

    return validLiens;
  }

  /**
   * Enrich saved liens to populate properties and investment scores
   * This is called after liens are saved to the database
   */
  private async enrichSavedLiens(liens: ScrapedTaxLien[]): Promise<void> {
    if (!this.realEstateService) {
      return;
    }

    const { supabaseAdmin } = await import("@/lib/supabase");
    const rateLimitDelay = 200; // 200ms delay between API calls

    for (let i = 0; i < liens.length; i++) {
      const lien = liens[i];

      try {
        // Rate limiting: wait between requests
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));
        }

        // Get the saved tax lien ID from the database
        const { data: savedLien, error: fetchError } = await supabaseAdmin
          .from("tax_liens")
          .select("id")
          .eq("county_id", this.countyId)
          .eq("parcel_id", lien.parcel_id)
          .single();

        if (fetchError || !savedLien) {
          console.error(`Error fetching saved lien ${lien.parcel_id}:`, fetchError);
          continue;
        }

        console.log(`[${i + 1}/${liens.length}] Enriching saved lien ${lien.parcel_id} (ID: ${savedLien.id})...`);

        // Enrich property - this will save to properties table and calculate investment scores
        await this.realEstateService.enrichProperty(savedLien.id, lien.parcel_id);

        console.log(`✅ Successfully enriched lien ${lien.parcel_id}`);
      } catch (error) {
        console.error(`Error enriching saved lien ${lien.parcel_id}:`, error);
        // Continue with next lien even if this one fails
      }
    }

    console.log(`✅ Completed enrichment for ${liens.length} saved liens`);
  }

  private async parsePdf(pdfUrl: string): Promise<ScrapedTaxLien[]> {
    try {
      // Download PDF
      console.log(`Downloading PDF from: ${pdfUrl}`);

      const pdfResponse = await axios.get(pdfUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const pdfBuffer = Buffer.from(pdfResponse.data);
      console.log(`✅ Successfully downloaded PDF (${pdfBuffer.length} bytes)`);

      // Validate that we have a PDF buffer
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error("Downloaded PDF buffer is empty");
      }

      // Check if it's actually a PDF by looking at the PDF header
      const pdfHeader = pdfBuffer.toString("ascii", 0, 4);
      if (pdfHeader !== "%PDF") {
        console.warn(`Warning: Buffer does not start with PDF header. Got: ${pdfHeader}`);
      }

      // Parse PDF using wrapper utility
      const pdfData = await parsePdf(pdfBuffer);
      const text = pdfData.text;

      console.log(`PDF parsed, text length: ${text.length} characters`);
      
      // If no text extracted, log a sample of the raw PDF buffer to help debug
      if (text.length === 0) {
        console.error(`⚠️ CRITICAL: No text extracted from PDF ${pdfUrl}`);
        console.error(`PDF buffer size: ${pdfBuffer.length} bytes`);
        console.error(`PDF header (first 100 bytes): ${pdfBuffer.toString('ascii', 0, Math.min(100, pdfBuffer.length))}`);
        console.error(`This PDF may be image-based or in a format that pdf2json cannot parse.`);
        console.error(`Consider using OCR or a different PDF parsing library.`);
        // Don't throw - return empty array so scraping can continue with other PDFs
        return [];
      }
      
      // Log first 500 characters to help debug parsing
      console.log(`PDF text sample (first 500 chars): ${text.substring(0, 500)}`);

      // Extract sale date from PDF (look for patterns like "February 3, 2026" or "Sale Date: ...")
      const datePatterns = [
        /(?:Sale\s+Date|Sale\s+on|Date\s+of\s+Sale)[\s:]+(\w+\s+\d{1,2},\s+\d{4})/i,
        /(\w+\s+\d{1,2},\s+\d{4})/,
        /Sheriffs-(\w+)-(\d{1,2})-(\d{4})/i, // From filename pattern
      ];

      let saleDate: string | undefined;
      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
          if (match[1] && match[2] && match[3]) {
            // Pattern 3: month, day, year
            saleDate = `${match[1]} ${match[2]}, ${match[3]}`;
          } else if (match[1]) {
            // Pattern 1 or 2: full date string
            saleDate = match[1];
          }
          break;
        }
      }

      // Also try to extract from URL if available
      if (!saleDate) {
        const urlDateMatch = pdfUrl.match(/Sheriffs-(\w+)-(\d{1,2})-(\d{4})/i);
        if (urlDateMatch) {
          saleDate = `${urlDateMatch[1]} ${urlDateMatch[2]}, ${urlDateMatch[3]}`;
        }
      }

      const liens: ScrapedTaxLien[] = [];

      // Split text into lines
      const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

      // Fulton County PDF format may vary - we'll try multiple parsing strategies
      // Strategy 1: Look for table-like structures with parcel IDs, owner names, addresses, amounts
      // Strategy 2: Look for patterns like "Parcel ID: ... Owner: ... Address: ... Amount: ..."

      // Try to find all table headers with Fulton County format:
      // SHERIFF'S SALE NUMBER, TAX PARCEL ID, SITUS
      // The PDF has multiple sections, each with its own header
      const headerIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        // Look for header pattern: "SHERIFF'S SALE NUMBER" (or variations) + "TAX PARCEL ID" + "SITUS"
        // The header might be split across multiple lines or on one line
        const hasSaleNumber = line.includes("sheriff") && (line.includes("sale") || line.includes("number"));
        const hasParcelId = (line.includes("tax") && line.includes("parcel")) || line.includes("parcel id");
        const hasSitus = line.includes("situs");
        
        // Check if this line has all three components, or check next few lines
        if (hasSaleNumber && hasParcelId && hasSitus) {
          headerIndices.push(i);
          console.log(`Found Fulton County header at line ${i}: ${lines[i]}`);
        } else if (hasSaleNumber || hasParcelId || hasSitus) {
          // Check if header is split across multiple lines (check current + next 2 lines)
          const combinedLines = lines.slice(i, Math.min(i + 3, lines.length))
            .map(l => l.toLowerCase())
            .join(" ");
          if (combinedLines.includes("sheriff") && combinedLines.includes("sale") && 
              combinedLines.includes("parcel") && combinedLines.includes("situs")) {
            headerIndices.push(i);
            console.log(`Found Fulton County header (split) starting at line ${i}`);
          }
        }
      }

      if (headerIndices.length > 0) {
        console.log(`Found ${headerIndices.length} table header(s)`);
        
        // Parse rows after each header until we hit the next header or end of document
        for (let headerIdx = 0; headerIdx < headerIndices.length; headerIdx++) {
          const headerIndex = headerIndices[headerIdx];
          const nextHeaderIndex = headerIdx < headerIndices.length - 1 
            ? headerIndices[headerIdx + 1] 
            : lines.length;
          
          console.log(`Parsing section ${headerIdx + 1}: lines ${headerIndex + 1} to ${nextHeaderIndex - 1}`);
          
          // Skip section title lines (like "NON-JUDICIAL DELINQUENT TAX LIENS" or "JUDICIAL FORECLOSURE LIENS")
          // These usually appear 1-3 lines before the header
          let startIndex = headerIndex + 1;
          
          // Find where the actual data rows start (skip header and any section titles)
          for (let i = headerIndex + 1; i < Math.min(headerIndex + 5, nextHeaderIndex); i++) {
            const line = lines[i].toLowerCase();
            // Skip section titles, separators, and header repeats
            if (line.includes("judicial") && (line.includes("delinquent") || line.includes("foreclosure"))) {
              startIndex = i + 1;
              continue;
            }
            if (line.includes("sheriff") && line.includes("sale") && line.includes("number")) {
              startIndex = i + 1;
              continue;
            }
            if (line.match(/^[\s|-\|]+$/)) {
              startIndex = i + 1;
              continue;
            }
            // If we find a line that looks like data (has parcel ID pattern), start parsing
            if (line.match(/\d{2}[-\s]?\d{3,6}[-\s]?\d{2,3}[-\s]?\d{2,3}[-\s]?\d{2,3}/)) {
              startIndex = i;
              break;
            }
          }
          
          // Parse rows after header until next header
          for (let i = startIndex; i < nextHeaderIndex; i++) {
            const line = lines[i];
            
            // Skip empty lines, separator lines, or section titles
            if (!line || line.trim().length === 0) continue;
            if (line.match(/^[\s|-\|]+$/)) continue; // Separator line
            if (line.toLowerCase().includes("judicial") && (line.toLowerCase().includes("delinquent") || line.toLowerCase().includes("foreclosure"))) continue;
            if (line.toLowerCase().includes("sheriff") && line.toLowerCase().includes("sale") && line.toLowerCase().includes("number")) continue; // Another header
            if (line.toLowerCase().includes("of") && line.toLowerCase().includes("2")) continue; // Page numbers like "1 OF 2"
            if (line.match(/^\d+\s+OF\s+\d+$/i)) continue; // Page numbers
            
            const lien = this.parseFultonTableRow(line, saleDate);
            if (lien) {
              liens.push(lien);
            }
          }
        }
      } else {
        // No clear header found - try pattern-based parsing
        console.log("No table header found, using pattern-based parsing...");
        
        // Look for parcel ID patterns (Fulton uses various formats)
        const parcelPatterns = [
          /(\d{2}[-\s]?\d{6}[-\s]?\d{2}[-\s]?\d{3}[-\s]?\d{3})/, // Standard format
          /(14[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{3})/, // Fulton format
          /(Parcel|APN|PIN)[\s:]+([A-Z0-9\s-]+)/i,
        ];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Try to find a line with a parcel ID
          for (const pattern of parcelPatterns) {
            const match = line.match(pattern);
            if (match) {
              const parcelId = match[2] || match[1];
              // Try to extract other fields from surrounding lines
              const lien = this.parseLienFromContext(lines, i, parcelId, saleDate);
              if (lien) {
                liens.push(lien);
                break;
              }
            }
          }
        }
      }

      console.log(`Parsed ${liens.length} liens from PDF`);
      return liens;
    } catch (error) {
      console.error(`Error parsing PDF ${pdfUrl}:`, error);
      throw error;
    }
  }

  /**
   * Parse a Fulton County table row with format: SHERIFF'S SALE NUMBER | TAX PARCEL ID | SITUS
   * Example: "0226-54580 | 14 -0184-0008-002-7 | 0 BOULEVARD GRANADA SW REAR"
   * Note: This format doesn't include owner name or amount, so we'll set defaults
   */
  private parseFultonTableRow(rowText: string, saleDate?: string): ScrapedTaxLien | null {
    try {
      // Try to split by common delimiters (pipe, tab, multiple spaces)
      let parts: string[] = [];

      if (rowText.includes("|")) {
        // Pipe-separated format (most common in PDFs)
        parts = rowText.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
      } else if (rowText.includes("\t")) {
        // Tab-separated format
        parts = rowText.split("\t").map((p) => p.trim()).filter((p) => p.length > 0);
      } else if (rowText.match(/\s{3,}/)) {
        // Multiple spaces as delimiter
        parts = rowText.split(/\s{3,}/).map((p) => p.trim()).filter((p) => p.length > 0);
      } else {
        // Try to parse by looking for patterns
        // Look for sale number first (usually numeric)
        const saleNumberMatch = rowText.match(/^(\d+)/);
        if (!saleNumberMatch) return null;

        const afterSaleNumber = rowText.substring(saleNumberMatch.index! + saleNumberMatch[0].length).trim();
        
        // Look for parcel ID (Fulton format: 14-XXX-XXX-XX-XXX or similar)
        const parcelMatch = afterSaleNumber.match(/(\d{2}[-\s]?\d{6}[-\s]?\d{2}[-\s]?\d{3}[-\s]?\d{3}|14[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{3}|\d{2}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{3})/);
        if (!parcelMatch) return null;

        const parcelId = parcelMatch[0].replace(/\s+/g, "-");
        const afterParcel = afterSaleNumber.substring(parcelMatch.index! + parcelMatch[0].length).trim();

        // Everything after parcel ID should be the SITUS (address)
        const situs = afterParcel.trim();
        
        if (situs.length < 3) return null; // Need at least some address info
        
        parts = [saleNumberMatch[0], parcelId, situs];
      }

      // Fulton format: [SALE_NUMBER, PARCEL_ID, SITUS]
      // Handle cases where we might have 2 or 3 parts
      let saleNumber = "";
      let parcelId = "";
      let situs = "";

      if (parts.length >= 3) {
        // Full format: SALE_NUMBER | PARCEL_ID | SITUS
        saleNumber = parts[0]?.trim() || "";
        parcelId = parts[1]?.trim() || "";
        situs = parts.slice(2).join(" ").trim(); // SITUS might have spaces, join remaining parts
      } else if (parts.length === 2) {
        // Might be: PARCEL_ID | SITUS (no sale number)
        // Or: SALE_NUMBER | PARCEL_ID (missing SITUS)
        // Check if first part looks like a sale number (format: 0226-54580)
        if (parts[0].match(/^\d{4}-\d{5}$/)) {
          saleNumber = parts[0].trim();
          parcelId = parts[1]?.trim() || "";
          situs = ""; // Missing SITUS
        } else {
          // Assume first is parcel ID, second is SITUS
          parcelId = parts[0]?.trim() || "";
          situs = parts[1]?.trim() || "";
        }
      } else if (parts.length === 1) {
        // Single part - try to extract parcel ID from it
        const parcelMatch = parts[0].match(/(\d{2}[-\s]?\d{3,6}[-\s]?\d{2,3}[-\s]?\d{2,3}[-\s]?\d{2,3})/);
        if (parcelMatch) {
          parcelId = parcelMatch[1].trim();
          // Try to extract SITUS (address) from the rest
          const afterParcel = parts[0].substring(parcelMatch.index! + parcelMatch[0].length).trim();
          if (afterParcel.length > 3) {
            situs = afterParcel;
          }
        } else {
          return null;
        }
      } else {
        return null;
      }

      // Validate parcel ID format (Fulton County format)
      // Allow various formats: 
      // - 14-0184-0008-002-7 (standard with dashes)
      // - 14 -0184-0008-002-7 (with spaces)
      // - 09F-2406-0104-012-1 (with "F")
      // - 14F-0042- LL-114-5 (with "F" and "LL")
      // - 17 -0247-0002-040-1 (with spaces)
      // Pattern: starts with 2 digits, may have letter, then segments separated by dashes/spaces
      const parcelIdPattern = /^\d{2}[A-Z]?[-\s]?[A-Z0-9\s-]+$/i;
      if (!parcelId.match(parcelIdPattern)) {
        // Try to clean it up - normalize spaces to dashes, but keep letters
        const cleanedParcelId = parcelId.replace(/\s+/g, "-").replace(/--+/g, "-");
        if (!cleanedParcelId.match(parcelIdPattern)) {
          console.warn(`Invalid parcel ID format: ${parcelId}`);
          return null;
        }
        // Use cleaned version
        parcelId = cleanedParcelId;
      }

      // Validate we have meaningful data
      if (!parcelId || parcelId.length < 5) return null;
      if (!situs || situs.length < 3) return null;

      const { address, city, zip } = this.parseAddress(situs);

      // Fulton PDF doesn't include owner name or amount, so we'll set defaults
      // These will be populated during enrichment if available
      return {
        parcel_id: parcelId.replace(/\s+/g, "-"),
        owner_name: "", // Will be populated during enrichment if available
        property_address: address,
        city: city || "Atlanta", // Default to Atlanta for Fulton County
        zip,
        tax_amount_due: 0, // Will be populated during enrichment if available
        sale_date: saleDate,
      };
    } catch (error) {
      console.error(`Error parsing Fulton table row: ${rowText.substring(0, 100)}`, error);
      return null;
    }
  }

  private parseLienFromContext(
    lines: string[],
    index: number,
    parcelId: string,
    saleDate?: string
  ): ScrapedTaxLien | null {
    // Look at current line and next few lines for owner, address, amount
    const contextLines = lines.slice(index, Math.min(index + 5, lines.length)).join(" ");

    const ownerMatch = contextLines.match(/(?:Owner|Name)[\s:]+([^\n,]+)/i);
    const addressMatch = contextLines.match(/(?:Address|Situs|Location)[\s:]+([^\n,]+)/i);
    const amountMatch = contextLines.match(/\$?([\d,]+\.\d{2})/);

    if (!ownerMatch || !addressMatch || !amountMatch) return null;

    const { address, city, zip } = this.parseAddress(addressMatch[1].trim());

    return {
      parcel_id: parcelId.replace(/\s+/g, "-"),
      owner_name: ownerMatch[1].trim(),
      property_address: address,
      city: city || "Atlanta",
      zip,
      tax_amount_due: this.parseCurrency(amountMatch[1]),
      sale_date: saleDate,
    };
  }
}
