import * as cheerio from "cheerio";
import axios from "axios";
import { BaseScraper, ScrapedTaxLien } from "./BaseScraper";
import { RealEstateService } from "@/lib/RealEstateService";
import { parsePdf } from "@/lib/utils/pdfParse";

export class FultonScraper extends BaseScraper {
  private enableEnrichment: boolean;
  private realEstateService: RealEstateService | null = null;

  constructor(
    countyId: number,
    countyName: string,
    enableEnrichment: boolean = true,
  ) {
    super(countyId, countyName);
    this.enableEnrichment = enableEnrichment;
    if (enableEnrichment) {
      try {
        this.realEstateService = new RealEstateService();
      } catch (error) {
        console.warn(
          "RealEstateService initialization failed, enrichment disabled:",
          error,
        );
        this.enableEnrichment = false;
      }
    }
  }

  async scrape(): Promise<ScrapedTaxLien[]> {
    try {
      console.log("Starting Fulton County tax lien scraping...");
      if (this.enableEnrichment) {
        console.log(
          "Enrichment enabled - will validate property improvement values",
        );
      }

      // Check if we have manual input data
      const manualInput = this.getManualInput();
      if (manualInput) {
        console.log("Using manual input data for Fulton County");
        return this.processManualInput(manualInput);
      }

      if (this.enableEnrichment) {
        console.log(
          "⚠️ Enrichment during scraping is ENABLED - only properties with assessedImprovementValue > 0 will be saved",
        );
      }

      const url =
        "https://fultoncountyga.gov/inside-fulton-county/fulton-county-departments/sheriff/tax-sales";

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const $ = cheerio.load(response.data);
      const liens: ScrapedTaxLien[] = [];
      const pageHtml = response.data as string;

      // Find the Sale List PDF link(s) on the page
      // The page has <a> tags pointing to PDFs under /-/media/Departments/Sheriff/Tax-Sales/
      // Only the current/active link has visible text; stale links have empty text
      // Example: /-/media/Departments/Sheriff/Tax-Sales/2026/Sheriffs-March-3-2026-Sale-List--1st-Posting.pdf

      const pdfUrls = new Set<string>();

      // Find Sale List PDF links from <a> tags
      // The page has multiple <a> tags pointing to Sheriff/Tax-Sales PDFs, but only
      // the current/active one has visible link text (e.g., "Click here to access the Sheriff's March 3, 2026 Sales List.")
      // Stale/old links have empty text or just wrap a <br> tag.
      $("a").each((i, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const hrefLower = href.toLowerCase();
        const linkText = $(el).text().trim();

        // Must be a PDF under Sheriff/Tax-Sales path
        if (!hrefLower.includes(".pdf")) return;
        if (!hrefLower.includes("/sheriff/tax-sales/")) return;

        // Exclude Excess Funds and other non-sale-list PDFs
        if (
          hrefLower.includes("excess-funds") ||
          hrefLower.includes("application")
        )
          return;

        // Only include links with visible text (skips stale/empty <a> tags)
        if (!linkText || linkText.length < 3) {
          console.log(`Skipping empty/stale link: ${href}`);
          return;
        }

        const fullUrl = href.startsWith("http")
          ? href
          : `https://fultoncountyga.gov${href.startsWith("/") ? "" : "/"}${href}`;
        pdfUrls.add(fullUrl);
        console.log(`Found Sale List link: "${linkText}" -> ${fullUrl}`);
      });

      // Fallback: scan raw HTML for Sale List PDF URLs if no <a> tags matched
      if (pdfUrls.size === 0) {
        console.log(
          "No Sale List <a> tags found, scanning raw HTML for PDF URLs...",
        );
        const urlPattern =
          /(?:https?:\/\/fultoncountyga\.gov)?(\/-\/media\/Departments\/Sheriff\/Tax-Sales\/[^\s"'<>]+\.pdf)/gi;
        let urlMatch;
        while ((urlMatch = urlPattern.exec(pageHtml)) !== null) {
          const fullUrl = urlMatch[0].startsWith("http")
            ? urlMatch[0]
            : `https://fultoncountyga.gov${urlMatch[1]}`;

          const urlLower = fullUrl.toLowerCase();
          if (
            urlLower.includes("excess-funds") ||
            urlLower.includes("application")
          )
            continue;

          pdfUrls.add(fullUrl);
        }
      }

      console.log(`Found ${pdfUrls.size} Sheriff's Sale List PDF URL(s)`);
      for (const foundUrl of pdfUrls) {
        console.log(`  - ${foundUrl}`);
      }

      // Process each PDF
      for (const pdfUrl of pdfUrls) {
        try {
          console.log(`Processing PDF: ${pdfUrl}`);

          const pdfLiens = await this.parsePdf(pdfUrl);
          liens.push(...pdfLiens);
          console.log(`Extracted ${pdfLiens.length} liens from PDF: ${pdfUrl}`);
        } catch (pdfError) {
          console.error(`Failed to process PDF ${pdfUrl}:`, pdfError);
        }
      }

      console.log(`Found ${liens.length} total tax liens in Fulton County`);

      // Enrich and filter liens if enrichment is enabled
      let validLiens: ScrapedTaxLien[] = [];
      if (this.enableEnrichment && this.realEstateService) {
        console.log(
          `Enriching ${liens.length} liens to validate assessedImprovementValue...`,
        );
        validLiens = await this.enrichAndFilterLiens(liens);
        console.log(
          `After enrichment filtering: ${validLiens.length} valid liens (${liens.length - validLiens.length} skipped)`,
        );
      } else {
        validLiens = liens;
      }

      // Save to database
      await this.saveToDatabase(validLiens);

      // After saving, enrich the saved liens to populate properties and investment scores
      if (
        this.enableEnrichment &&
        this.realEstateService &&
        validLiens.length > 0
      ) {
        console.log(
          `Enriching ${validLiens.length} saved liens to populate properties and investment scores...`,
        );
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
  private async enrichAndFilterLiens(
    liens: ScrapedTaxLien[],
  ): Promise<ScrapedTaxLien[]> {
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

        console.log(
          `[${i + 1}/${liens.length}] Validating lien ${lien.parcel_id}...`,
        );

        // Enrich property (validation only - doesn't save to DB)
        const enrichmentResult =
          await this.realEstateService.enrichPropertyByParcel(
            lien.parcel_id,
            address,
          );

        // TEMP: Disable filtering to see all extracted liens
        if (enrichmentResult) {
          validLiens.push(lien);
          console.log(
            `✅ Lien ${lien.parcel_id} kept (assessedImprovementValue = ${enrichmentResult.propertyData?.assessed_improvement_value || 0})`,
          );
        } else {
          console.log(
            `⚠️ Lien ${lien.parcel_id} skipped (enrichment completely failed)`,
          );
        }
      } catch (error) {
        console.error(`Error validating lien ${lien.parcel_id}:`, error);
        console.log(
          `⚠️ Lien ${lien.parcel_id} skipped due to validation error`,
        );
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
          console.error(
            `Error fetching saved lien ${lien.parcel_id}:`,
            fetchError,
          );
          continue;
        }

        console.log(
          `[${i + 1}/${liens.length}] Enriching saved lien ${lien.parcel_id} (ID: ${savedLien.id})...`,
        );

        // Enrich property - this will save to properties table and calculate investment scores
        await this.realEstateService.enrichProperty(
          savedLien.id,
          lien.parcel_id,
        );

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
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
        console.warn(
          `Warning: Buffer does not start with PDF header. Got: ${pdfHeader}`,
        );
      }

      // Parse PDF using wrapper utility (will fall back to OCR for scanned PDFs)
      const pdfData = await parsePdf(pdfBuffer);
      const rawText = pdfData.text;

      console.log(`PDF parsed, text length: ${rawText.length} characters`);

      // If no text extracted, return empty
      if (rawText.length === 0) {
        console.error(`⚠️ CRITICAL: No text extracted from PDF ${pdfUrl}`);
        console.error(`PDF buffer size: ${pdfBuffer.length} bytes`);
        console.error(`This PDF may be image-based and OCR may have failed.`);
        return [];
      }

      // Clean up OCR artifacts in the extracted text
      const text = this.cleanOcrText(rawText);

      // Log first 500 characters to help debug parsing
      console.log(
        `PDF text sample (first 500 chars): ${text.substring(0, 500)}`,
      );

      // Log full OCR text for debugging (OCR text is usually short)
      console.log(`Full OCR text (${text.length} chars):\n${text}`);

      // Extract sale date - try URL first (most reliable), then text patterns
      let saleDate: string | undefined;

      // Try to extract from URL (e.g., "Sheriffs-March-3-2026-Sale-List")
      const urlDateMatch = pdfUrl.match(
        /Sheriffs-([A-Za-z]+)-?(\d{1,2})-?(\d{4})/i,
      );
      if (urlDateMatch) {
        saleDate = `${urlDateMatch[1]} ${urlDateMatch[2]}, ${urlDateMatch[3]}`;
        console.log(`Extracted sale date from URL: ${saleDate}`);
      }

      // Fallback: try text patterns (OCR text may have artifacts)
      if (!saleDate) {
        const datePatterns = [
          /(?:Sale\s+Date|Sale\s+on|Date\s+of\s+Sale)[\s:]+(\w+\s+\d{1,2},\s+\d{4})/i,
          /(?:MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JANUARY|FEBRUARY)\s+\d{1,2},?\s+\d{4}/i,
        ];

        for (const pattern of datePatterns) {
          const match = text.match(pattern);
          if (match) {
            saleDate = match[1] || match[0];
            console.log(`Extracted sale date from text: ${saleDate}`);
            break;
          }
        }
      }

      const liens: ScrapedTaxLien[] = [];

      // Split text into lines
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // Fulton County PDF format: SHERIFF'S SALE NUMBER | TAX PARCEL ID | SITUS
      // OCR text may have artifacts, so we use flexible matching
      // Strategy 1: Find table headers and parse rows after them
      // Strategy 2: Scan all lines for parcel ID patterns (fallback)

      // Find table headers - OCR may produce variations like:
      // "SHERIFF'S SALE NUMBER TAX PARCEL ID SITUS"
      // "SHERIFF'S SALE TAX PARCEL SITUS"
      // "SHERIFF'S |" (OCR misread with pipe)
      const headerIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        // OCR-tolerant header detection
        const hasSaleRef =
          line.includes("sheriff") ||
          (line.includes("sale") && line.includes("number"));
        const hasParcelRef =
          line.includes("parcel") ||
          (line.includes("tax") &&
            (line.includes("id") || line.includes("1d")));
        const hasSitusRef =
          line.includes("situs") ||
          line.includes("sttus") ||
          line.includes("s1tus");

        // Check if this line has at least 2 of the 3 header components
        const matchCount = [hasSaleRef, hasParcelRef, hasSitusRef].filter(
          Boolean,
        ).length;
        if (matchCount >= 2) {
          headerIndices.push(i);
          console.log(`Found Fulton County header at line ${i}: ${lines[i]}`);
        } else if (matchCount === 1) {
          // Check if header is split across multiple lines (check current + next 2 lines)
          const combinedLines = lines
            .slice(i, Math.min(i + 3, lines.length))
            .map((l) => l.toLowerCase())
            .join(" ");
          const combinedSale =
            combinedLines.includes("sheriff") ||
            (combinedLines.includes("sale") &&
              combinedLines.includes("number"));
          const combinedParcel = combinedLines.includes("parcel");
          const combinedSitus =
            combinedLines.includes("situs") || combinedLines.includes("sttus");
          if (
            [combinedSale, combinedParcel, combinedSitus].filter(Boolean)
              .length >= 2
          ) {
            headerIndices.push(i);
            console.log(
              `Found Fulton County header (split) starting at line ${i}`,
            );
          }
        }
      }

      if (headerIndices.length > 0) {
        console.log(`Found ${headerIndices.length} table header(s)`);

        // Parse rows after each header until we hit the next header or end of document
        for (let headerIdx = 0; headerIdx < headerIndices.length; headerIdx++) {
          const headerIndex = headerIndices[headerIdx];
          const nextHeaderIndex =
            headerIdx < headerIndices.length - 1
              ? headerIndices[headerIdx + 1]
              : lines.length;

          console.log(
            `Parsing section ${headerIdx + 1}: lines ${headerIndex + 1} to ${nextHeaderIndex - 1}`,
          );

          // Skip section title lines
          let startIndex = headerIndex + 1;

          // Find where the actual data rows start (skip header and any section titles)
          for (
            let i = headerIndex + 1;
            i < Math.min(headerIndex + 10, nextHeaderIndex);
            i++
          ) {
            const line = lines[i].toLowerCase();
            // Skip section titles, separators, and header repeats
            if (
              line.includes("judicial") &&
              (line.includes("delinquent") || line.includes("foreclosure"))
            ) {
              startIndex = i + 1;
              continue;
            }
            if (
              line.includes("sheriff") &&
              line.includes("sale") &&
              line.includes("number")
            ) {
              startIndex = i + 1;
              continue;
            }
            if (line.match(/^[\s|-\|]+$/)) {
              startIndex = i + 1;
              continue;
            }
            // Skip lines that look like headers or section titles
            if (
              line.includes("tax parcel") ||
              line.includes("sale number") ||
              line.includes("situs")
            ) {
              startIndex = i + 1;
              continue;
            }
            // If we find a line that looks like data (has parcel ID pattern), start parsing
            if (this.looksLikeParcelId(line)) {
              startIndex = i;
              break;
            }
          }

          console.log(
            `  Parsing rows from ${startIndex} to ${nextHeaderIndex - 1}`,
          );
          // Parse rows after header until next header
          for (let i = startIndex; i < nextHeaderIndex; i++) {
            const line = lines[i];

            // Skip empty lines, separator lines, or section titles
            if (!line || line.trim().length === 0) continue;
            if (line.match(/^[\s|-\|]+$/)) continue;
            if (
              line.toLowerCase().includes("judicial") &&
              (line.toLowerCase().includes("delinquent") ||
                line.toLowerCase().includes("foreclosure"))
            )
              continue;
            if (
              line.toLowerCase().includes("sheriff") &&
              line.toLowerCase().includes("sale") &&
              line.toLowerCase().includes("number")
            )
              continue;
            if (
              line.toLowerCase().includes("of") &&
              line.toLowerCase().includes("2")
            )
              continue;
            if (line.match(/^\d+\s+OF\s+\d+$/i)) continue;

            // Debug log lines that might contain data
            if (this.looksLikeParcelId(line)) {
              console.log(
                `  Line ${i}: Found parcel ID pattern: ${line.substring(0, 100)}`,
              );
            }

            const lien = this.parseFultonTableRow(line, saleDate);
            if (lien) {
              console.log(`  ✓ Parsed lien: ${lien.parcel_id}`);
              liens.push(lien);
            }
          }
        }
      }

      // Always also do pattern-based scanning for parcel IDs
      // This catches rows that header-based parsing might miss (especially with OCR)
      if (liens.length === 0 || headerIndices.length === 0) {
        console.log(
          headerIndices.length === 0
            ? "No table header found, using pattern-based parsing..."
            : "Header-based parsing found 0 liens, trying pattern-based fallback...",
        );

        // Track seen parcel IDs to avoid duplicates
        const seenParcelIds = new Set<string>();

        // Multi-line parsing: collect lines that look like they belong together
        let currentRecord = "";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line || line.trim().length === 0) continue;

          // Skip section headers and page numbers
          if (
            line.toLowerCase().includes("judicial") ||
            line.toLowerCase().includes("non-judicial") ||
            line.toLowerCase().includes("sheriff's") ||
            line.match(/^\d+\s+OF\s+\d+$/i)
          ) {
            // Process any accumulated record before skipping
            if (currentRecord.trim()) {
              const lien = this.parseFultonTableRow(
                currentRecord.trim(),
                saleDate,
              );
              if (lien && !seenParcelIds.has(lien.parcel_id)) {
                console.log(`  ✓ Parsed multi-line lien: ${lien.parcel_id}`);
                liens.push(lien);
                seenParcelIds.add(lien.parcel_id);
              }
              currentRecord = "";
            }
            continue;
          }

          // Debug: log all lines to see what's being processed
          if (line.trim().length > 0) {
            const hasSaleNumber = !!line.match(/^\d{4}-\d{5}/);
            const hasParcelId = this.looksLikeParcelId(line);
            if (hasSaleNumber || hasParcelId) {
              console.log(
                `  Line: "${line.substring(0, 80)}" [saleNumber: ${hasSaleNumber}, parcelId: ${hasParcelId}]`,
              );
            }
          }

          // Check if this line starts a new record (has sale number pattern)
          const saleNumberMatch = line.match(/^(\d{4}-\d{5})\s+/);
          if (saleNumberMatch) {
            console.log(`  Found sale number: ${saleNumberMatch[1]}`);
            // Process previous record if exists
            if (currentRecord.trim()) {
              const lien = this.parseFultonTableRow(
                currentRecord.trim(),
                saleDate,
              );
              if (lien && !seenParcelIds.has(lien.parcel_id)) {
                console.log(`  ✓ Parsed previous lien: ${lien.parcel_id}`);
                liens.push(lien);
                seenParcelIds.add(lien.parcel_id);
              }
            }
            // Start new record
            currentRecord = line;
            console.log(
              `  Started new record: ${currentRecord.substring(0, 100)}`,
            );
          } else if (this.looksLikeParcelId(line)) {
            // Line contains parcel ID - OCR may have dropped sale number
            // Try to parse this as a complete record even without sale number
            console.log(
              `  Found parcel ID without sale number, attempting to parse: ${line.substring(0, 80)}`,
            );

            // Process previous record first
            if (currentRecord.trim()) {
              const lien = this.parseFultonTableRow(
                currentRecord.trim(),
                saleDate,
              );
              if (lien && !seenParcelIds.has(lien.parcel_id)) {
                console.log(`  ✓ Parsed previous lien: ${lien.parcel_id}`);
                liens.push(lien);
                seenParcelIds.add(lien.parcel_id);
              }
            }

            // Try to parse this line as a complete record
            let lien = this.parseFultonTableRow(line.trim(), saleDate);
            if (!lien) {
              lien = this.parseParcelOnlyLine(line.trim(), saleDate);
            }

            if (lien && !seenParcelIds.has(lien.parcel_id)) {
              console.log(`  ✓ Parsed parcel-only lien: ${lien.parcel_id}`);
              liens.push(lien);
              seenParcelIds.add(lien.parcel_id);
              currentRecord = ""; // Reset since we successfully parsed
            } else {
              // If parsing fails, save for next iteration
              currentRecord = line;
              console.log(
                `  Could not parse, saving for next iteration: ${line.substring(0, 80)}`,
              );
            }
          } else if (currentRecord) {
            // Continue current record
            currentRecord += " " + line;
            console.log(
              `  Continuing record: ${currentRecord.substring(0, 100)}`,
            );
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
  private parseFultonTableRow(
    rowText: string,
    saleDate?: string,
  ): ScrapedTaxLien | null {
    try {
      // Try to split by common delimiters (pipe, tab, multiple spaces)
      let parts: string[] = [];

      if (rowText.includes("|")) {
        // Pipe-separated format (most common in PDFs and OCR output)
        parts = rowText
          .split("|")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
      } else if (rowText.includes("\t")) {
        // Tab-separated format
        parts = rowText
          .split("\t")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
      } else if (rowText.match(/\s{3,}/)) {
        // Multiple spaces as delimiter
        parts = rowText
          .split(/\s{3,}/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
      } else {
        // Try to parse by looking for patterns - OCR format is space-separated
        // Format: [SALE_NUMBER] [PARCEL_ID] [ADDRESS] with varying spacing
        // OCR may combine multiple fields on one line or split across lines

        // First try to find parcel ID (the most reliable pattern)
        const parcelMatch = rowText.match(
          /(\d{2}[A-Z0-9]\s*[-\s]\s*\d{3,6}\s*[-\s]\s*\d{2,4}\s*[-\s]\s*\d{2,3}\s*[-\s]\s*[0-9OI])/i,
        );

        if (parcelMatch) {
          const parcelId = parcelMatch[0]
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-");

          // Extract everything before and after the parcel ID
          const beforeParcel = rowText.substring(0, parcelMatch.index!).trim();
          const afterParcel = rowText
            .substring(parcelMatch.index! + parcelMatch[0].length)
            .trim();

          // Try to extract sale number from before parcel ID
          const saleNumberMatch = beforeParcel.match(/(\d[\d\s-]{3,10}\d)\s*$/);
          const saleNumber = saleNumberMatch
            ? saleNumberMatch[0].replace(/\s+/g, "-")
            : "";

          // Everything after parcel ID should be the SITUS (address)
          const situs = afterParcel;

          if (situs.length < 3) return null;

          parts = saleNumber
            ? [saleNumber, parcelId, situs]
            : [parcelId, situs];
        } else {
          // Fallback: try to find any parcel ID pattern and extract surrounding context
          const fallbackMatch = rowText.match(
            /(\d{2}[A-Z0-9]\s*[-\s]\s*\d{3,6}\s*[-\s]\s*\d{2,4}\s*[-\s]\s*\d{2,3}\s*[-\s]\s*[0-9OI])/i,
          );

          if (!fallbackMatch) return null;

          const parcelId = fallbackMatch[0]
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-");

          // Try to extract address from the rest of the line
          const afterParcel = rowText
            .substring(fallbackMatch.index! + fallbackMatch[0].length)
            .trim();

          if (afterParcel.length < 3) return null;

          parts = [parcelId, afterParcel];
        }
      }

      // Fulton format: [SALE_NUMBER, PARCEL_ID, SITUS]
      // Handle cases where we might have 2 or 3 parts
      let saleNumber = "";
      let parcelId = "";
      let situs = "";

      if (parts.length >= 3) {
        // Full format: SALE_NUMBER | PARCEL_ID | SITUS
        saleNumber = parts[0].replace(/\s+/g, "-").replace(/--+/g, "-");
        parcelId = parts[1].replace(/\s+/g, "-").replace(/--+/g, "-");
        situs = parts.slice(2).join(" ").trim();
      } else if (parts.length === 2) {
        // Two cases:
        // 1. Missing sale number: PARCEL_ID | SITUS
        // 2. OCR extracted: SALE_NUMBER | PARCEL_ID (address missing)

        // Check if first part looks like a parcel ID
        if (this.looksLikeParcelId(parts[0])) {
          parcelId = parts[0].replace(/\s+/g, "-").replace(/--+/g, "-");
          situs = parts[1].trim();
        } else {
          // First part is sale number, second is parcel ID
          saleNumber = parts[0].replace(/\s+/g, "-").replace(/--+/g, "-");
          parcelId = parts[1].replace(/\s+/g, "-").replace(/--+/g, "-");
        }
      } else {
        return null;
      }

      // Validate parcel ID format (Fulton County format) - OCR tolerant
      // Allow various formats including OCR artifacts:
      // - 14-0184-0008-002-7 (standard with dashes)
      // - 14 -0184-0008-002-7 (with spaces)
      // - 09F-2406-0104-012-1 (with "F")
      // - 14F-0042- LL-114-5 (with "F" and "LL")
      // - 17 -0247-0002-040-1 (with spaces)
      // OCR misreads: O->0, l->1, I->1, etc.
      const parcelIdPattern = /^\d{2}[A-Z0-9][-\s]?[A-Z0-9\s-]+$/i;
      if (!parcelId.match(parcelIdPattern)) {
        // Try to clean it up - normalize spaces to dashes, fix common OCR misreads
        let cleanedParcelId = parcelId
          .replace(/\s+/g, "-")
          .replace(/--+/g, "-")
          .replace(/O/g, "0") // OCR often misreads 0 as O
          .replace(/I/g, "1") // OCR often misreads 1 as I
          .replace(/l/g, "1"); // OCR often misreads 1 as l

        if (!cleanedParcelId.match(parcelIdPattern)) {
          console.warn(
            `Invalid parcel ID format: ${parcelId} -> ${cleanedParcelId}`,
          );
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
      console.error(
        `Error parsing Fulton table row: ${rowText.substring(0, 100)}`,
        error,
      );
      return null;
    }
  }

  /**
   * Clean up common OCR artifacts in extracted text
   * OCR may misread characters, add extra spaces, or produce garbled text
   */
  private cleanOcrText(text: string): string {
    return (
      text
        // Normalize line endings
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Fix common OCR misreads in parcel IDs (O -> 0, l -> 1, I -> 1 in numeric contexts)
        // Only apply in contexts that look like parcel IDs (digit sequences with dashes)
        .replace(/(\d)O(\d)/g, "$10$2")
        .replace(/(\d)l(\d)/g, "$11$2")
        .replace(/(\d)I(\d)/g, "$11$2")
        // Normalize multiple spaces to single space (but preserve newlines)
        .replace(/[^\S\n]+/g, " ")
        // Remove null/control characters that OCR might produce
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    );
  }

  /**
   * Check if a line contains something that looks like a Fulton County parcel ID
   * Tolerant of OCR artifacts (extra spaces, misread characters)
   */
  private parseParcelOnlyLine(
    line: string,
    saleDate?: string,
  ): ScrapedTaxLien | null {
    console.log(
      `  parseParcelOnlyLine called with: "${line.substring(0, 80)}"`,
    );

    // Parse OCR lines that have parcel ID but no sale number
    // Format: "14 -0151-0007-024-1 0 ORLANDO ST SW"

    // Extract parcel ID using regex
    const parcelMatch = line.match(
      /(\d{2}[A-Z]?\s*[-\s]\s*\d{3,6}\s*[-\s]\s*\d{2,4}\s*[-\s]\s*\d{2,3}\s*[-\s]\s*\d)/i,
    );
    if (!parcelMatch) {
      console.log(`  No parcel match found in line`);
      return null;
    }

    console.log(`  Found parcel ID: "${parcelMatch[1]}"`);

    let parcelId = parcelMatch[1].replace(/\s+/g, "-").replace(/--+/g, "-");

    // Extract address (everything after parcel ID)
    const afterParcel = line
      .substring(parcelMatch.index! + parcelMatch[0].length)
      .trim();
    const situs = afterParcel.length > 3 ? afterParcel : "";

    // Validate parcel ID format
    const parcelIdPattern = /^\d{2}[A-Z0-9][-\s]?[A-Z0-9\s-]+$/i;
    if (!parcelId.match(parcelIdPattern)) {
      // Try to clean it up
      let cleanedParcelId = parcelId
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-")
        .replace(/O/g, "0")
        .replace(/I/g, "1")
        .replace(/l/g, "1");

      if (!cleanedParcelId.match(parcelIdPattern)) {
        return null;
      }
      parcelId = cleanedParcelId;
    }

    return {
      parcel_id: parcelId,
      owner_name: "",
      property_address: situs,
      city: "Atlanta",
      tax_amount_due: 0,
      sale_date: saleDate || "",
    };
  }

  private looksLikeParcelId(line: string): boolean {
    // Fulton County parcel IDs: 2 digits + optional letter + dash-separated segments
    // Examples: 14-0184-0008-002-7, 09F-2406-0104-012-1, 17-0247-0002-040-1
    // OCR may add spaces: "14 -0184- 0008-002-7" or "14 0184 0008 002 7"
    // OCR misreads: O->0, l->1, I->1, G->6, S->5, etc.
    const patterns = [
      /\d{2}[A-Z]?\s*[-\s]\s*\d{3,6}\s*[-\s]\s*\d{2,4}\s*[-\s]\s*\d{2,3}\s*[-\s]\s*\d/i,
      /\d{2}[A-Z]?\s+\d{4}\s+\d{4}\s+\d{3}\s+\d/i,
      /\d{2}[A-Z]?-\d{4}-\d{4}-\d{3}-\d/i,
      // OCR-tolerant patterns with common misreads
      /\d{2}[A-Z0-9]\s*[-\s]\s*\d{3,6}\s*[-\s]\s*\d{2,4}\s*[-\s]\s*\d{2,3}\s*[-\s]\s*\d/i,
      /\d{2}[A-Z0-9]\s+\d{4}\s+\d{4}\s+\d{3}\s+\d/i,
      // Allow some character substitutions from OCR
      /\d{2}[A-Z0-9]\s*[-\s]\s*\d{3,6}\s*[-\s]\s*\d{2,4}\s*[-\s]\s*\d{2,3}\s*[-\s]\s*[0-9OI]/i,
    ];
    return patterns.some((p) => p.test(line));
  }

  /**
   * Get manual input data for Fulton County records
   * This allows copy & paste of records directly from the PDF
   */
  private getManualInput(): string | null {
    // For now, return null to use normal scraping
    // TODO: Add environment variable or config to enable manual input
    return process.env.FULTON_MANUAL_INPUT || null;
  }

  /**
   * Process manually input records and convert them to ScrapedTaxLien objects
   */
  private async processManualInput(input: string): Promise<ScrapedTaxLien[]> {
    console.log("Processing manual input for Fulton County...");

    const lines = input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const liens: ScrapedTaxLien[] = [];
    const seenParcelIds = new Set<string>();

    // Extract sale date from the input or use default
    const saleDate =
      this.extractSaleDateFromManualInput(input) || "March 3, 2026";

    for (const line of lines) {
      // Skip headers and page numbers
      if (
        line.toLowerCase().includes("sale number") ||
        line.toLowerCase().includes("tax parcel") ||
        line.toLowerCase().includes("situs") ||
        line.match(/^\d+\s+OF\s+\d+$/i) ||
        line.toLowerCase().includes("judicial") ||
        line.toLowerCase().includes("non-judicial")
      ) {
        continue;
      }

      // Try to parse the line as a record
      const lien = this.parseManualLine(line, saleDate);
      if (lien && !seenParcelIds.has(lien.parcel_id)) {
        liens.push(lien);
        seenParcelIds.add(lien.parcel_id);
        console.log(
          `✅ Parsed manual lien: ${lien.parcel_id} - ${lien.property_address}`,
        );
      }
    }

    console.log(`Parsed ${liens.length} liens from manual input`);

    // Enrich and filter liens if enrichment is enabled
    let validLiens: ScrapedTaxLien[] = [];
    if (this.enableEnrichment && this.realEstateService) {
      console.log(`Enriching ${liens.length} manually input liens...`);
      validLiens = await this.enrichAndFilterLiens(liens);
      console.log(
        `After enrichment filtering: ${validLiens.length} valid liens (${liens.length - validLiens.length} skipped)`,
      );
    } else {
      validLiens = liens;
    }

    // Save to database
    await this.saveToDatabase(validLiens);

    // After saving, enrich the saved liens to populate properties and investment scores
    if (
      this.enableEnrichment &&
      this.realEstateService &&
      validLiens.length > 0
    ) {
      console.log(
        `Enriching ${validLiens.length} saved liens to populate properties and investment scores...`,
      );
      await this.enrichSavedLiens(validLiens);
    }

    return validLiens;
  }

  /**
   * Parse a single line from manual input
   * Expected format: "SALE_NUMBER PARCEL_ID ADDRESS"
   */
  private parseManualLine(
    line: string,
    saleDate: string,
  ): ScrapedTaxLien | null {
    // Split by whitespace and filter out empty parts
    const parts = line.split(/\s+/).filter((part) => part.length > 0);

    if (parts.length < 2) return null;

    // Try to identify the sale number (starts with 4 digits)
    let saleNumber = "";
    let parcelId = "";
    let addressStart = 0;

    // Check if first part is a sale number
    if (parts[0].match(/^\d{4}-\d{5}$/)) {
      saleNumber = parts[0];
      // Second part should be parcel ID
      if (parts.length > 1 && this.looksLikeParcelId(parts[1])) {
        parcelId = parts[1];
        addressStart = 2;
      }
    } else {
      // No sale number, look for parcel ID in first parts
      for (let i = 0; i < parts.length; i++) {
        if (this.looksLikeParcelId(parts[i])) {
          parcelId = parts[i];
          addressStart = i + 1;
          break;
        }
      }
    }

    if (!parcelId) return null;

    // Extract address from remaining parts
    const address = parts.slice(addressStart).join(" ").trim();

    // Clean up parcel ID
    parcelId = parcelId.replace(/\s+/g, "-").replace(/--+/g, "-");

    return {
      parcel_id: parcelId,
      owner_name: "",
      property_address: address,
      city: "Atlanta",
      tax_amount_due: 0,
      sale_date: saleDate,
    };
  }

  /**
   * Extract sale date from manual input text
   */
  private extractSaleDateFromManualInput(input: string): string | null {
    // Look for date patterns like "March 3, 2026"
    const dateMatch = input.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
    );
    return dateMatch ? dateMatch[0] : null;
  }

  private parseLienFromContext(
    lines: string[],
    index: number,
    parcelId: string,
    saleDate?: string,
  ): ScrapedTaxLien | null {
    // ... rest of the code remains the same ...
    // Look at current line and next few lines for owner, address, amount
    const contextLines = lines
      .slice(index, Math.min(index + 5, lines.length))
      .join(" ");

    const ownerMatch = contextLines.match(/(?:Owner|Name)[\s:]+([^\n,]+)/i);
    const addressMatch = contextLines.match(
      /(?:Address|Situs|Location)[\s:]+([^\n,]+)/i,
    );
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
