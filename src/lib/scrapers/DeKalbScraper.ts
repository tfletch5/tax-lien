import * as cheerio from "cheerio";
import axios from "axios";
import { BaseScraper, ScrapedTaxLien } from "./BaseScraper";
import { RealEstateService } from "@/lib/RealEstateService";

export class DeKalbScraper extends BaseScraper {
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
      console.log("Starting DeKalb County tax lien scraping...");
      if (this.enableEnrichment) {
        console.log("⚠️ Enrichment during scraping is ENABLED - only properties with assessedImprovementValue > 0 will be saved");
      }

      // DeKalb uses an HTML form-based search
      const url =
        "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html";

      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const $ = cheerio.load(response.data);
      const liens: ScrapedTaxLien[] = [];

      // Look for tax sale listings in table format
      const tables = $("table");
      console.log(`Found ${tables.length} tables`);

      // Use the second table (index 1) which has 230 rows of data
      const table = tables.eq(1);
      const rows = table.find("tr");

      console.log(`Processing table with ${rows.length} rows`);

      rows.each((index, row) => {
        if (index === 0) return; // Skip header row

        const $row = $(row);
        const cells = $row.find("td");

        if (cells.length >= 15) {
          // We need at least 15 columns
          // Use the correct column indices based on the debug output
          const taxSaleDate = $(cells[0]).text().trim(); // Tax Sale Date
          const parcelId = $(cells[1]).text().trim(); // Parcel ID
          const mapRef = $(cells[2]).text().trim(); // Map Ref
          const taxSaleId = $(cells[3]).text().trim(); // Tax Sale ID
          const ownerName = $(cells[4]).text().trim(); // Owner
          const propertyAddress = $(cells[5]).text().trim(); // Address
          const tenant = $(cells[6]).text().trim(); // Tenant
          const defendant = $(cells[7]).text().trim(); // Defendant
          const levyType = $(cells[8]).text().trim(); // Levy Type
          const lienBook = $(cells[9]).text().trim(); // Lien Book
          const page = $(cells[10]).text().trim(); // Page
          const levyDate = $(cells[11]).text().trim(); // Levy Date
          const minYear = $(cells[12]).text().trim(); // Min Year
          const maxYear = $(cells[13]).text().trim(); // Max Year
          const taxAmountText = $(cells[14]).text().trim(); // Total Tax Due

          // Debug: Show raw cell data for first few rows
          if (index <= 3) {
            console.log(`Row ${index}:`, {
              taxSaleDate,
              parcelId,
              mapRef,
              taxSaleId,
              ownerName,
              propertyAddress,
              tenant,
              defendant,
              levyType,
              lienBook,
              page,
              levyDate,
              minYear,
              maxYear,
              taxAmountText,
            });
          }

          // Validate we have meaningful data (skip header row)
          if (
            parcelId &&
            ownerName &&
            propertyAddress &&
            taxAmountText &&
            parcelId !== "Parcel ID" &&
            ownerName !== "Owner"
          ) {
            const taxAmount = this.parseCurrency(taxAmountText);
            const { address, city, zip } = this.parseAddress(propertyAddress);

            // Add default city and state for DeKalb County if not present
            const finalCity = city || "ATLANTA"; // Default to Atlanta for DeKalb County
            const finalState = "GA"; // Georgia
            const finalZip = zip || "";

            liens.push({
              parcel_id: parcelId,
              owner_name: ownerName,
              property_address: address,
              city: finalCity,
              zip: finalZip,
              tax_amount_due: taxAmount,
              sale_date: taxSaleDate || undefined,
              legal_description: `Tax Sale ID: ${taxSaleId}, Levy Type: ${levyType}, Lien Book: ${lienBook}, Page: ${page}`,
            });
          }
        }
      });

      console.log(`Found ${liens.length} tax liens in DeKalb County`);

      // Debug: Show first few records
      if (liens.length > 0) {
        console.log("Sample records found:");
        liens.slice(0, 3).forEach((lien, index) => {
          console.log(
            `${index + 1}. Parcel: ${lien.parcel_id}, Owner: ${lien.owner_name}, Address: ${lien.property_address}, Tax: $${lien.tax_amount_due}`,
          );
        });
      }

      // Enrich and filter liens if enrichment is enabled
      let validLiens = liens;
      if (this.enableEnrichment && this.realEstateService && liens.length > 0) {
        console.log(`Enriching ${liens.length} liens to validate assessedImprovementValue...`);
        validLiens = await this.enrichAndFilterLiens(liens);
        console.log(`After enrichment filtering: ${validLiens.length} valid liens (${liens.length - validLiens.length} skipped)`);
      }

      // Save only valid liens to database
      if (validLiens.length > 0) {
        console.log(`Attempting to save ${validLiens.length} tax liens to database...`);
        await this.saveToDatabase(validLiens);
        console.log(`Database save complete: ${validLiens.length} successful, 0 failed`);
      } else {
        console.log("No valid liens to save after enrichment filtering");
      }

      // After saving, enrich the saved liens to populate properties and investment scores
      if (this.enableEnrichment && this.realEstateService && validLiens.length > 0) {
        console.log(`Enriching ${validLiens.length} saved liens to populate properties and investment scores...`);
        await this.enrichSavedLiens(validLiens);
      }

      return validLiens;
    } catch (error) {
      console.error("Error scraping DeKalb County:", error);
      throw new Error(
        `DeKalb scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Enrich liens during scraping to filter out properties with assessedImprovementValue = 0
   * This is called before saving to database
   */
  private async enrichAndFilterLiens(liens: ScrapedTaxLien[]): Promise<ScrapedTaxLien[]> {
    if (!this.realEstateService) {
      return liens;
    }

    const validLiens: ScrapedTaxLien[] = [];
    const rateLimitDelay = 200; // 200ms delay between API calls

    console.log(`Enriching ${liens.length} liens to validate assessedImprovementValue...`);

    for (let i = 0; i < liens.length; i++) {
      const lien = liens[i];
      try {
        // Rate limiting
        if (i > 0 && i % 10 === 0) {
          console.log(`Enrichment progress: ${i}/${liens.length}...`);
        }
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));
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
    const parcelIds = liens.map((l) => l.parcel_id);

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
        console.log(`Enriching saved lien ${savedLien.parcel_id} (ID: ${savedLien.id})...`);

        // Enrich property - this will save to properties table and calculate investment scores
        await this.realEstateService.enrichProperty(savedLien.id, savedLien.parcel_id);

        console.log(`✅ Successfully enriched lien ${savedLien.parcel_id}`);
      } catch (error) {
        console.error(`Error enriching saved lien ${savedLien.parcel_id}:`, error);
        // Continue with next lien even if this one fails
      }
    }

    console.log(`✅ Completed enrichment for ${liens.length} saved liens`);
  }
}
