import * as cheerio from "cheerio";
import axios from "axios";
import { BaseScraper, ScrapedTaxLien } from "./BaseScraper";
import { RealEstateService } from "@/lib/RealEstateService";
import { parsePdf } from "@/lib/utils/pdfParse";

export class ClaytonScraper extends BaseScraper {
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
      console.log("Starting Clayton County tax lien scraping...");

      // Navigate to the Tax Commissioner forms page where tax sale PDFs are listed
      const url = "https://publicaccess.claytoncountyga.gov/forms/htmlframe.aspx?mode=content/home_commissioner.htm";

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const $ = cheerio.load(response.data);
      const liens: ScrapedTaxLien[] = [];

      // Look for PDF links to tax sale listings
      // The PDFs are in the Forms section with links like "February 2026 Tax Sales"
      // Look for links that contain "tax_sale" in href or "Tax Sale" in text
      const allLinks = $('a[href]')
        .map((i, el) => {
          const href = $(el).attr("href");
          const text = $(el).text().trim();
          return { href, text };
        })
        .get();

      // Filter for tax sale PDF links (exclude registration forms and non-PDF links)
      const pdfLinks = allLinks.filter(link => {
        if (!link.href) return false;
        const hrefLower = link.href.toLowerCase();
        const textLower = link.text.toLowerCase();
        
        // Skip registration forms and non-PDF links
        if (textLower.includes("registration") || textLower.includes("bidder") || textLower.includes("form")) {
          return false;
        }
        if (!hrefLower.includes(".pdf") && !hrefLower.includes("tax_sale") && !hrefLower.includes("tax-sale")) {
          return false;
        }
        
        // Check if it's a tax sale PDF link
        return (hrefLower.includes("tax_sale") || 
                hrefLower.includes("tax-sale") ||
                hrefLower.includes("taxsale") ||
                (textLower.includes("tax") && textLower.includes("sale") && hrefLower.includes(".pdf")));
      });

      console.log(`Found ${pdfLinks.length} tax sale PDF links`);
      
      // Log found links for debugging
      pdfLinks.forEach((link, idx) => {
        console.log(`  Link ${idx + 1}: ${link.text} -> ${link.href}`);
      });

      // Process PDF links
      for (const link of pdfLinks) {
        try {
          const href = link.href;
          if (!href) continue;

          // Construct full URL
          // Handle relative paths - Clayton County uses paths like "../content/PDF/..."
          let pdfUrl = href;
          if (!href.startsWith("http")) {
            if (href.startsWith("../")) {
              // Remove "../" and construct full path
              pdfUrl = `https://publicaccess.claytoncountyga.gov/${href.replace(/^\.\.\//, "")}`;
            } else if (href.startsWith("/")) {
              pdfUrl = `https://publicaccess.claytoncountyga.gov${href}`;
            } else {
              pdfUrl = `https://publicaccess.claytoncountyga.gov/${href}`;
            }
          }

          console.log(`Processing PDF: ${link.text || link.href || 'Unknown'}`);
          console.log(`PDF URL: ${pdfUrl}`);

          const pdfLiens = await this.parsePdf(pdfUrl);
          liens.push(...pdfLiens);
          console.log(`Extracted ${pdfLiens.length} liens from PDF: ${link.text || link.href || 'Unknown'}`);
        } catch (pdfError) {
          console.error(`Failed to process PDF ${link.text || link.href || 'Unknown'}:`, pdfError);
        }
      }

      // Also look for any HTML content with tax sale information
      $(".tax-sale, .property-listing, .delinquent-list").each(
        (index, element) => {
          const $element = $(element);
          const text = $element.text();

          // Try to extract property information from text
          const propertyPattern =
            /(?:Parcel|PID)[\s:]*([A-Z0-9-]+)[\s\S]*?(?:Owner|Name)[\s:]*([^\n]+)[\s\S]*?(?:Address|Location)[\s:]*([^\n]+)[\s\S]*?\$[\d,]+\.?\d*/gi;

          let match;
          while ((match = propertyPattern.exec(text)) !== null) {
            const amountMatch = match[0].match(/\$[\d,]+\.?\d*/);
            const parcelMatch = match[0].match(
              /(?:Parcel|PID)[\s:]*([A-Z0-9-]+)/i,
            );
            const ownerMatch = match[0].match(/(?:Owner|Name)[\s:]*([^\n]+)/i);
            const addressMatch = match[0].match(
              /(?:Address|Location)[\s:]*([^\n]+)/i,
            );

            if (parcelMatch && ownerMatch && addressMatch && amountMatch) {
              const { address, city, zip } = this.parseAddress(
                addressMatch[1].trim(),
              );

              liens.push({
                parcel_id: parcelMatch[1].trim(),
                owner_name: ownerMatch[1].trim(),
                property_address: address,
                city,
                zip,
                tax_amount_due: this.parseCurrency(amountMatch[0]),
              });
            }
          }
        },
      );

      // If still no data, generate sample data
      if (liens.length === 0) {
        console.log("No tax lien data found, generating sample data...");
        // liens.push(...this.generateMockClaytonData("February", 2026));
      }

      console.log(`Found ${liens.length} total tax liens in Clayton County`);

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
      console.error("Error scraping Clayton County:", error);
      throw new Error(
        `Clayton scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Parse PDF to extract tax lien data
   * Clayton County PDF format needs to be examined to identify the correct headers
   */
  private async parsePdf(pdfUrl: string): Promise<ScrapedTaxLien[]> {
    try {
      console.log(`Downloading PDF from: ${pdfUrl}`);
      
      // Download PDF
      const response = await axios.get(pdfUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const buffer = Buffer.from(response.data);
      console.log(`✅ Successfully downloaded PDF (${buffer.length} bytes)`);

      // Validate PDF buffer
      if (!buffer || buffer.length === 0) {
        throw new Error("Downloaded PDF buffer is empty");
      }

      // Check PDF header
      const pdfHeader = buffer.toString("ascii", 0, 4);
      if (pdfHeader !== "%PDF") {
        console.warn(`Warning: Buffer does not start with PDF header. Got: ${pdfHeader}`);
      }

      // Parse PDF
      const { text } = await parsePdf(buffer);
      console.log(`PDF parsed, text length: ${text.length} characters`);

      if (text.length === 0) {
        console.error(`⚠️ No text extracted from PDF ${pdfUrl}`);
        return [];
      }

      // Log first 1000 characters to help identify structure
      console.log(`PDF text sample (first 1000 chars): ${text.substring(0, 1000)}`);

      // Extract sale date from PDF text or URL
      let saleDate: string | undefined;
      const datePatterns = [
        /(?:Sale\s+Date|Sale\s+on|Date\s+of\s+Sale)[\s:]+(\w+\s+\d{1,2},\s+\d{4})/i,
        /(\w+\s+\d{1,2},\s+\d{4})/,
      ];

      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          saleDate = match[1];
          break;
        }
      }

      // Also try to extract from URL (e.g., feb_tax_sale_listing_2026.pdf)
      // But convert to a proper date format or use the date from the PDF rows
      // We'll use the date from individual rows instead, so don't set a default here
      // If no date is found in rows, sale_date will be undefined (which is fine)

      const liens: ScrapedTaxLien[] = [];
      
      // The PDF text appears to be extracted as a continuous string
      // Look for the header first, then parse rows after it
      // Header pattern: "Date Parcel#/Name Property Location Years Cry-Out Bid"
      const headerPattern = /Date\s+Parcel#\/Name\s+Property\s+Location\s+Years\s+(?:Fair\s+Market\s+Value\s+)?Cry-Out\s+Bid/i;
      const headerMatch = text.match(headerPattern);
      
      if (!headerMatch) {
        console.log("Could not find header in PDF text, trying pattern-based parsing...");
        // Fallback: try to find rows with parcel ID patterns
        const parcelPattern = /(\d{5}[A-Z]\s+[A-Z]\d{3}(?:\s+[A-Z]\d{2})?)\s+\/([A-Z\s]+(?:LLC|INC|CORP)?)/g;
        const matches = Array.from(text.matchAll(parcelPattern));
        for (const match of matches) {
          const lien = this.parseClaytonTableRow(match[0], saleDate);
          if (lien) {
            liens.push(lien);
          }
        }
        console.log(`Parsed ${liens.length} liens using pattern-based parsing`);
        return liens;
      }
      
      const headerIndex = headerMatch.index || 0;
      const afterHeader = text.substring(headerIndex + headerMatch[0].length);
      
      console.log(`Found header at position ${headerIndex}`);
      console.log(`Text after header (first 500 chars): ${afterHeader.substring(0, 500)}`);
      
      // Now parse rows - look for parcel ID patterns to identify row boundaries
      // Parcel ID format: 5 digits + letter + space + letter + 3 digits (e.g., "06002A A010")
      const parcelIdPattern = /(\d{5}[A-Z]\s+[A-Z]\d{3}(?:\s+[A-Z]\d{2})?)/g;
      const parcelMatches = Array.from(afterHeader.matchAll(parcelIdPattern));
      
      console.log(`Found ${parcelMatches.length} potential rows based on parcel IDs`);
      
      // Extract rows starting from each parcel ID
      for (let i = 0; i < parcelMatches.length; i++) {
        const start = parcelMatches[i].index || 0;
        const end = i < parcelMatches.length - 1 
          ? (parcelMatches[i + 1].index || afterHeader.length)
          : afterHeader.length;
        
        const rowText = afterHeader.substring(start, end).trim();
        
        // Skip if too short or doesn't look like a data row
        if (rowText.length < 20) continue;
        
        const lien = this.parseClaytonTableRow(rowText, saleDate);
        if (lien) {
          liens.push(lien);
        }
      }
      
      // If we didn't get any liens, try a different approach - split by date patterns
      if (liens.length === 0) {
        console.log("No liens found with parcel pattern, trying date-based splitting...");
        const datePattern = /(\d{2}\/\d{2}\/\d{4})/g;
        const dateMatches = Array.from(text.matchAll(datePattern));
        
        // Group consecutive dates (they might be repeated in the PDF)
        // Then look for the first unique date followed by data
        let lastUniqueDateIndex = -1;
        for (let i = 0; i < dateMatches.length; i++) {
          if (i === 0 || dateMatches[i][1] !== dateMatches[i - 1][1]) {
            lastUniqueDateIndex = dateMatches[i].index || 0;
            break; // Found first unique date
          }
        }
        
        if (lastUniqueDateIndex >= 0) {
          // Find where the header starts (should be after the repeated dates)
          const afterDates = text.substring(lastUniqueDateIndex);
          const headerInAfterDates = afterDates.match(headerPattern);
          if (headerInAfterDates) {
            const dataStart = (headerInAfterDates.index || 0) + headerInAfterDates[0].length;
            const dataSection = afterDates.substring(dataStart);
            
            // Now parse rows from data section
            const dataParcelMatches = Array.from(dataSection.matchAll(parcelIdPattern));
            for (let i = 0; i < dataParcelMatches.length; i++) {
              const start = dataParcelMatches[i].index || 0;
              const end = i < dataParcelMatches.length - 1 
                ? (dataParcelMatches[i + 1].index || dataSection.length)
                : dataSection.length;
              
              const rowText = dataSection.substring(start, end).trim();
              if (rowText.length < 20) continue;
              
              const lien = this.parseClaytonTableRow(rowText, saleDate);
              if (lien) {
                liens.push(lien);
              }
            }
          }
        }
      }
      
      console.log(`Parsed ${liens.length} liens from PDF`);
      return liens;
    } catch (error) {
      console.error(`Error parsing PDF ${pdfUrl}:`, error);
      throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Detect column order from header line
   * Clayton County headers: Date | Parcel#/Name | Property Location | Years | Fair Market Value | Cry-Out Bid
   */
  private detectColumnOrder(headerLine: string): { date: number; parcelName: number; propertyLocation: number; years: number; fairMarketValue: number; cryOutBid: number } {
    const parts = headerLine.split(/\s{2,}|\t|\|/).map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
    
    let dateIdx = -1;
    let parcelNameIdx = -1;
    let propertyLocationIdx = -1;
    let yearsIdx = -1;
    let fairMarketValueIdx = -1;
    let cryOutBidIdx = -1;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes("date") && dateIdx === -1) {
        dateIdx = i;
      }
      if ((part.includes("parcel") && part.includes("name")) || 
          (part.includes("parcel#") && part.includes("/")) && parcelNameIdx === -1) {
        parcelNameIdx = i;
      }
      if (part.includes("property") && part.includes("location") && propertyLocationIdx === -1) {
        propertyLocationIdx = i;
      }
      if (part.includes("years") && yearsIdx === -1) {
        yearsIdx = i;
      }
      if (part.includes("fair") && part.includes("market") && part.includes("value") && fairMarketValueIdx === -1) {
        fairMarketValueIdx = i;
      }
      if ((part.includes("cry-out") || part.includes("cry out") || part.includes("bid")) && cryOutBidIdx === -1) {
        cryOutBidIdx = i;
      }
    }
    
    return { 
      date: dateIdx, 
      parcelName: parcelNameIdx, 
      propertyLocation: propertyLocationIdx, 
      years: yearsIdx, 
      fairMarketValue: fairMarketValueIdx, 
      cryOutBid: cryOutBidIdx 
    };
  }

  /**
   * Parse a single table row from Clayton County PDF
   * Format: Date | Parcel#/Name | Property Location | Years | Fair Market Value | Cry-Out Bid
   * Example: 02/03/2026 | 06002A A010 /TURNER MARY L | 0 CAMP DR | 2022,2023,2024 | 25,000 | 2817.60
   */
  private parseClaytonTableRow(
    rowText: string,
    saleDate?: string,
    columnOrder?: { date: number; parcelName: number; propertyLocation: number; years: number; fairMarketValue: number; cryOutBid: number }
  ): ScrapedTaxLien | null {
    try {
      let parcelId: string | null = null;
      let ownerName = "";
      let address = "";
      let taxAmount = 0;
      let rowSaleDate = saleDate;

      if (columnOrder && columnOrder.parcelName >= 0) {
        // Use column order to parse - split by multiple spaces (2+ spaces) which is common in PDF tables
        // Also handle cases where data might be tightly packed
        let parts = rowText.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
        
        // If splitting by 2+ spaces doesn't give us enough parts, try a smarter approach
        // Look for patterns: date (MM/DD/YYYY), parcel ID (5 digits + letter + space + letter + 3 digits), etc.
        if (parts.length < 4) {
          // Try to identify columns by patterns
          const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{4})/);
          const parcelMatch = rowText.match(/(\d{5}[A-Z]\s+[A-Z]\d{3}(?:\s+[A-Z]\d{2})?)/);
          const addressMatch = rowText.match(/(\d+\s+[A-Z][A-Z\s]+(?:DR|RD|ST|AVE|CT|LN|BLVD|PKWY|WAY|CIR|TRCE))/i);
          const yearsMatch = rowText.match(/(\d{4}(?:,\s*\d{4})*)/);
          const amountMatch = rowText.match(/([\d,]+\.\d{2})$/);
          
          // Reconstruct parts array based on matches
          const matchedParts: Array<{ text: string; index: number }> = [];
          if (dateMatch && dateMatch.index !== undefined) matchedParts.push({ text: dateMatch[1], index: dateMatch.index });
          if (parcelMatch && parcelMatch.index !== undefined) matchedParts.push({ text: parcelMatch[1], index: parcelMatch.index });
          if (addressMatch && addressMatch.index !== undefined) matchedParts.push({ text: addressMatch[1], index: addressMatch.index });
          if (yearsMatch && yearsMatch.index !== undefined) matchedParts.push({ text: yearsMatch[1], index: yearsMatch.index });
          if (amountMatch && amountMatch.index !== undefined) matchedParts.push({ text: amountMatch[1], index: amountMatch.index });
          
          // Sort by index and extract text
          parts = matchedParts.sort((a, b) => a.index - b.index).map(p => p.text);
        }
        
        console.log(`Row split into ${parts.length} parts:`, parts);
        
        // Extract Date and convert to ISO format (YYYY-MM-DD) for database
        if (columnOrder.date >= 0 && parts.length > columnOrder.date) {
          const dateText = parts[columnOrder.date];
          // Parse date format like "02/03/2026" to "2026-02-03" (ISO format)
          const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dateMatch) {
            const month = dateMatch[1];
            const day = dateMatch[2];
            const year = dateMatch[3];
            // Convert to ISO date format (YYYY-MM-DD) for PostgreSQL
            rowSaleDate = `${year}-${month}-${day}`;
          }
        }
        
        // Extract Parcel#/Name (contains both parcel ID and owner name separated by "/")
        if (columnOrder.parcelName >= 0 && parts.length > columnOrder.parcelName) {
          const parcelNameText = parts[columnOrder.parcelName];
          // Format: "06002A A010 /TURNER MARY L" or "06160D E003 /CREEKSTONE CLAYTON LLC"
          // Parcel ID is before the "/", owner name is after
          const slashIndex = parcelNameText.indexOf("/");
          if (slashIndex > 0) {
            parcelId = parcelNameText.substring(0, slashIndex).trim();
            ownerName = parcelNameText.substring(slashIndex + 1).trim();
          } else {
            // No slash, assume entire field is parcel ID
            parcelId = parcelNameText.trim();
          }
        }
        
        // Extract Property Location
        if (columnOrder.propertyLocation >= 0 && parts.length > columnOrder.propertyLocation) {
          address = parts[columnOrder.propertyLocation];
        }
        
        // Extract Cry-Out Bid (this is the tax amount due)
        if (columnOrder.cryOutBid >= 0 && parts.length > columnOrder.cryOutBid) {
          const amountText = parts[columnOrder.cryOutBid];
          taxAmount = this.parseCurrency(amountText);
        }
      } else {
        // Pattern-based parsing fallback - extract fields using regex patterns
        // Row format: Date | Parcel#/Name | Property Location | Years | Fair Market Value | Cry-Out Bid
        // Example: "02/03/2026 06002A A010 /TURNER MARY L 0 CAMP DR 2022,2023,2024 25,000 2817.60"
        
        // Extract date and convert to ISO format (YYYY-MM-DD) for database
        const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) {
          const month = dateMatch[1];
          const day = dateMatch[2];
          const year = dateMatch[3];
          // Convert to ISO date format (YYYY-MM-DD) for PostgreSQL
          rowSaleDate = `${year}-${month}-${day}`;
        }
        
        // Extract parcel ID and owner name
        // Format: "06002A A010 /TURNER MARY L" or "06160D E003 /CREEKSTONE CLAYTON LLC"
        const parcelNameMatch = rowText.match(/(\d{5}[A-Z]\s+[A-Z]\d{3}(?:\s+[A-Z]\d{2})?)\s+\/([A-Z\s&]+(?:LLC|INC|CORP|JR|SR)?)/);
        if (parcelNameMatch) {
          parcelId = parcelNameMatch[1].trim();
          ownerName = parcelNameMatch[2].trim();
        } else {
          // Try without owner name
          const parcelOnlyMatch = rowText.match(/(\d{5}[A-Z]\s+[A-Z]\d{3}(?:\s+[A-Z]\d{2})?)/);
          if (parcelOnlyMatch) {
            parcelId = parcelOnlyMatch[1].trim();
          }
        }
        
        // Extract address (street address pattern)
        const addressMatch = rowText.match(/(\d+\s+[A-Z][A-Z\s]+(?:DR|RD|ST|AVE|CT|LN|BLVD|PKWY|WAY|CIR|TRCE|VILLAGE|DRIVE|STREET|ROAD|AVENUE|BOULEVARD|PARKWAY|COURT|CIRCLE))/i);
        if (addressMatch) {
          address = addressMatch[1].trim();
        }
        
        // Extract Cry-Out Bid (usually the last number with decimals, might have commas)
        // Look for pattern like "2817.60" or "2,533.92" at the end
        const amountMatch = rowText.match(/([\d,]+\.\d{2})(?:\s|$)/);
        if (amountMatch) {
          taxAmount = this.parseCurrency(amountMatch[1]);
        }
      }

      // Validate we have at least a parcel ID
      if (!parcelId || parcelId.length < 3) {
        return null;
      }

      // Parse address to extract city and zip
      const { address: parsedAddress, city, zip } = this.parseAddress(address);

      return {
        parcel_id: parcelId,
        owner_name: ownerName,
        property_address: parsedAddress,
        city,
        zip,
        tax_amount_due: taxAmount,
        sale_date: rowSaleDate,
      };
    } catch (error) {
      console.error(`Error parsing row: ${rowText}`, error);
      return null;
    }
  }

  /**
   * Enrich each lien and filter out those with assessedImprovementValue = 0
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
        // Rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        }

        const address = lien.property_address;
        const result = await this.realEstateService.enrichPropertyByParcel(
          lien.parcel_id,
          address
        );

        if (result && result.isValid) {
          validLiens.push(lien);
        } else {
          console.log(`Skipping lien ${lien.parcel_id}: assessedImprovementValue = 0`);
        }
      } catch (error) {
        console.error(`Error enriching lien ${lien.parcel_id}:`, error);
        // Skip liens that fail enrichment
      }
    }

    return validLiens;
  }

  /**
   * Enrich saved liens to populate properties and investment_scores tables
   */
  private async enrichSavedLiens(liens: ScrapedTaxLien[]): Promise<void> {
    if (!this.realEstateService) {
      return;
    }

    // Fetch the saved tax liens to get their IDs
    const { supabaseAdmin } = await import("@/lib/supabase");
    const parcelIds = liens.map(l => l.parcel_id);

    const { data: savedLiens, error } = await supabaseAdmin
      .from("tax_liens")
      .select("id, parcel_id")
      .eq("county_id", this.countyId)
      .in("parcel_id", parcelIds);

    if (error || !savedLiens) {
      console.error("Error fetching saved liens for enrichment:", error);
      return;
    }

    console.log(`Enriching ${savedLiens.length} saved liens...`);

    for (const savedLien of savedLiens) {
      try {
        await this.realEstateService.enrichProperty(savedLien.id, savedLien.parcel_id);
      } catch (error) {
        console.error(`Error enriching saved lien ${savedLien.parcel_id}:`, error);
      }
    }
  }

  private generateMockClaytonData(
    month: string,
    year: number,
  ): ScrapedTaxLien[] {
    return [
      {
        parcel_id: "08-001",
        owner_name: "Robert Johnson",
        property_address: "1000 Main St",
        city: "Forest Park",
        zip: "30297",
        tax_amount_due: 1200,
        sale_date: `${month} 4, ${year}`,
      },
      {
        parcel_id: "08-002",
        owner_name: "Mary Williams",
        property_address: "2000 Highway 85",
        city: "Riverdale",
        zip: "30274",
        tax_amount_due: 950,
        sale_date: `${month} 4, ${year}`,
      },
      {
        parcel_id: "08-003",
        owner_name: "James Brown",
        property_address: "3000 Upper Riverdale Rd",
        city: "Jonesboro",
        zip: "30236",
        tax_amount_due: 2100,
        sale_date: `${month} 4, ${year}`,
      },
    ];
  }
}
