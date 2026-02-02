import * as cheerio from "cheerio";
import axios from "axios";
import { BaseScraper, ScrapedTaxLien } from "./BaseScraper";

export class DeKalbScraper extends BaseScraper {
  async scrape(): Promise<ScrapedTaxLien[]> {
    try {
      console.log("Starting DeKalb County tax lien scraping...");

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

      // Save to database
      await this.saveToDatabase(liens);

      return liens;
    } catch (error) {
      console.error("Error scraping DeKalb County:", error);
      throw new Error(
        `DeKalb scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
