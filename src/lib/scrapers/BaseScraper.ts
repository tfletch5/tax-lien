import { TaxLien } from "@/types";
import { supabaseAdmin } from "@/lib/supabase";

export interface ScrapedTaxLien {
  parcel_id: string;
  owner_name: string;
  property_address: string;
  city?: string;
  zip?: string;
  tax_amount_due: number;
  sale_date?: string;
  legal_description?: string;
}

export abstract class BaseScraper {
  protected countyId: number;
  protected countyName: string;

  constructor(countyId: number, countyName: string) {
    this.countyId = countyId;
    this.countyName = countyName;
  }

  abstract scrape(): Promise<ScrapedTaxLien[]>;

  protected async saveToDatabase(liens: ScrapedTaxLien[]): Promise<void> {
    let logData: any = null;

    try {
      // Start a scrape log
      const { data } = await supabaseAdmin
        .from("scrape_logs")
        .insert({
          county_id: this.countyId,
          status: "running",
          records_found: liens.length,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      logData = data;

      // Insert tax liens with upsert to handle duplicates
      const taxLienPromises = liens.map(async (lien) => {
        return supabaseAdmin.from("tax_liens").upsert(
          {
            county_id: this.countyId,
            parcel_id: lien.parcel_id,
            owner_name: lien.owner_name,
            property_address: lien.property_address,
            city: lien.city,
            zip: lien.zip,
            tax_amount_due: lien.tax_amount_due,
            sale_date: lien.sale_date,
            legal_description: lien.legal_description,
            scraped_at: new Date().toISOString(),
          },
          {
            onConflict: "county_id,parcel_id",
          },
        );
      });

      await Promise.all(taxLienPromises);

      // Update scrape log
      await supabaseAdmin
        .from("scrape_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", logData.id);

      console.log(
        `Successfully scraped ${liens.length} tax liens for ${this.countyName}`,
      );
    } catch (error) {
      console.error(`Error scraping ${this.countyName}:`, error);

      // Update scrape log with error
      if (logData?.id) {
        await supabaseAdmin
          .from("scrape_logs")
          .update({
            status: "failed",
            error_message:
              error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", logData.id);
      }

      throw error;
    }
  }

  protected parseCurrency(value: string): number {
    const cleanValue = value.replace(/[$,\s]/g, "");
    const numValue = parseFloat(cleanValue);
    return isNaN(numValue) ? 0 : numValue;
  }

  protected parseAddress(address: string): {
    address: string;
    city?: string;
    zip?: string;
  } {
    // Try to parse city and zip from address
    const parts = address.split(",");
    const mainAddress = parts[0]?.trim() || address;

    let city: string | undefined;
    let zip: string | undefined;

    if (parts.length > 1) {
      const cityZip = parts[1].trim();
      const cityZipParts = cityZip.split(/\s+/);

      if (cityZipParts.length >= 2) {
        zip = cityZipParts[cityZipParts.length - 1];
        city = cityZipParts.slice(0, -1).join(" ");
      }
    }

    return { address: mainAddress, city, zip };
  }
}
