import * as cheerio from "cheerio";
import axios from "axios";
import { BaseScraper, ScrapedTaxLien } from "./BaseScraper";
import { RealEstateService } from "@/lib/RealEstateService";
import { parsePdf } from "@/lib/utils/pdfParse";

export class CobbScraper extends BaseScraper {
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
      console.log("Starting Cobb County tax lien scraping...");
      if (this.enableEnrichment) {
        console.log("⚠️ Enrichment during scraping is ENABLED - only properties with assessedImprovementValue > 0 will be saved");
      }

      const url = "https://www.cobbtax.gov/property/tax_sale/index.php";

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const $ = cheerio.load(response.data);
      const liens: ScrapedTaxLien[] = [];

      // Look for tax sale information and links to listings
      const taxSaleLinks = $(
        'a[href*="delinquent"], a[href*="tax"], a[href*="sale"]',
      )
        .map((i, el) => {
          const href = $(el).attr("href");
          const text = $(el).text();
          return { href, text };
        })
        .get();

      console.log(`Found ${taxSaleLinks.length} tax sale links`);

      // Look for tax sale dates and property listings
      const taxSaleDates: string[] = [];
      $(".tax-sale-date, .sale-date, h2, h3").each((index, element) => {
        const text = $(element).text();
        const dateMatch = text.match(
          /\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d{1,2},\s+\d{4}/,
        );
        if (dateMatch) {
          taxSaleDates.push(dateMatch[0]);
        }
      });

      // Look for property listings in tables or lists
      $("table tr, .property-item, .tax-item").each((index, element) => {
        const $element = $(element);
        const $cells = $element.find("td, th");

        if ($cells.length >= 3) {
          const parcelId = $cells.eq(0).text().trim();
          const ownerName = $cells.eq(1).text().trim();
          const addressInfo = $cells.eq(2).text().trim();
          const taxAmountText =
            $cells.length > 3 ? $cells.eq(3).text().trim() : "";

          if (
            parcelId &&
            ownerName &&
            addressInfo &&
            !parcelId.toLowerCase().includes("parcel")
          ) {
            const { address, city, zip } = this.parseAddress(addressInfo);
            const taxAmount = taxAmountText
              ? this.parseCurrency(taxAmountText)
              : 0;

            liens.push({
              parcel_id: parcelId,
              owner_name: ownerName,
              property_address: address,
              city,
              zip,
              tax_amount_due: taxAmount,
              sale_date: taxSaleDates[0], // Use first found date
            });
          }
        }
      });

      // Alternative: Look for structured content in divs
      if (liens.length === 0) {
        $(".content, .main-content, #main").each((index, element) => {
          const $element = $(element);
          const text = $element.text();

          // Try to find property information patterns
          const propertyPattern =
            /(?:Parcel|PID)[\s:]*([A-Z0-9-]+)[\s\S]*?(?:Owner|Name)[\s:]*([^\n]+)[\s\S]*?(?:Address|Location)[\s:]*([^\n]+)[\s\S]*?\$[\d,]+\.?\d*/gi;

          let match;
          while ((match = propertyPattern.exec(text)) !== null) {
            const { address, city, zip } = this.parseAddress(match[3].trim());
            const amountMatch = match[0].match(/\$[\d,]+\.?\d*/);

            liens.push({
              parcel_id: match[1].trim(),
              owner_name: match[2].trim(),
              property_address: address,
              city,
              zip,
              tax_amount_due: amountMatch
                ? this.parseCurrency(amountMatch[0])
                : 0,
              sale_date: taxSaleDates[0],
            });
          }
        });
      }

      // If still no data, generate sample data for demonstration
      if (liens.length === 0) {
        console.log("No tax lien data found, generating sample data...");
        // liens.push(...this.generateMockCobbData());
      }

      console.log(`Found ${liens.length} total tax liens in Cobb County`);

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
      console.error("Error scraping Cobb County:", error);
      throw new Error(
        `Cobb scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
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

  private generateMockCobbData(): ScrapedTaxLien[] {
    return [
      {
        parcel_id: "15-1234",
        owner_name: "John Smith",
        property_address: "123 Roswell St",
        city: "Marietta",
        zip: "30060",
        tax_amount_due: 2500,
        sale_date: "May 5, 2026",
      },
      {
        parcel_id: "15-5678",
        owner_name: "Jane Doe",
        property_address: "456 Cobb Pkwy",
        city: "Austell",
        zip: "30168",
        tax_amount_due: 1800,
        sale_date: "May 5, 2026",
      },
    ];
  }
}
