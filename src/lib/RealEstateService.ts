import axios from "axios";
import { supabaseAdmin } from "@/lib/supabase";
import {
  calculateLTV,
  calculateEquity,
  calculateInvestmentScore,
} from "@/lib/utils";

interface RealEstateAPIResponse {
  address: string;
  estimatedValue: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSizeSqft?: number;
  propertyType?: string;
  mortgageBalance?: number;
}

export class RealEstateService {
  private apiKey: string;
  private baseUrl = "https://api.realestateapi.com/v2";

  constructor() {
    this.apiKey = process.env.REALESTATE_API_KEY!;
    if (!this.apiKey) {
      throw new Error("REALESTATE_API_KEY environment variable is required");
    }
  }

  async enrichProperty(
    taxLienId: string,
    address: string,
    city?: string,
    zip?: string,
  ): Promise<void> {
    try {
      console.log(`Enriching property: ${address}`);

      const fullAddress = [address, city, zip].filter(Boolean).join(", ");
      console.log(`Full address: ${fullAddress}`);

      // Try different API endpoints and formats
      const endpoints = [
        {
          url: `${this.baseUrl}/PropertySearch`,
          params: { address: fullAddress, apiKey: this.apiKey },
        },
        // {
        //   url: `${this.baseUrl}/properties`,
        //   params: { address: fullAddress, apiKey: this.apiKey },
        // },
        // {
        //   url: "https://api.realestateapi.com/v2/property",
        //   params: { address: fullAddress, apiKey: this.apiKey },
        // },
        // {
        //   url: "https://realestateapi.com/v2/property",
        //   params: { address: fullAddress, apiKey: this.apiKey },
        // },
      ];

      let propertyData: any = null;
      let lastError: any = null;

      for (const endpoint of endpoints) {
        try {
          console.log(`Trying endpoint: ${endpoint.url}`);

          const response = await axios.post(
            endpoint.url,
            {
              street: fullAddress,
              state: "GA",
            },
            {
              headers: {
                Accept: "application/json",
                "User-Agent": "TaxLienDashboard/1.0",
                "x-api-key": this.apiKey,
              },
              timeout: 10000,
            },
          );

          console.log(`✅ Success with ${endpoint.url}:`, response.status);

          // Handle the RealEstateAPI response format
          if (
            response.data &&
            response.data.data &&
            Array.isArray(response.data.data)
          ) {
            // Find the best matching property from the array
            const properties = response.data.data;
            const bestMatch =
              properties.find(
                (prop: any) =>
                  prop.address &&
                  prop.address.street &&
                  prop.address.street
                    .toLowerCase()
                    .includes(address.toLowerCase().split(" ")[0]),
              ) || properties[0]; // Use first property if no good match

            propertyData = bestMatch;
            console.log(
              `Found ${properties.length} properties, selected best match`,
            );
          } else {
            // Fallback to direct response if it's not an array format
            propertyData = response.data;
          }

          if (propertyData) {
            break;
          }
        } catch (error: any) {
          console.log(
            `❌ Failed with ${endpoint.url}:`,
            error.response?.status || error.message,
          );
          lastError = error;

          if (error.response?.status !== 404) {
            // For non-404 errors, don't try other endpoints
            throw error;
          }
        }
      }

      if (!propertyData) {
        throw lastError || new Error("All API endpoints failed");
      }

      // Save property details to database
      await supabaseAdmin.from("properties").upsert(
        {
          tax_lien_id: taxLienId,
          estimated_value: propertyData.estimatedValue || 0,
          last_sale_price: propertyData.lastSaleAmount
            ? parseFloat(propertyData.lastSaleAmount)
            : 0,
          last_sale_date: propertyData.lastSaleDate || null,
          year_built: propertyData.yearBuilt || null,
          bedrooms: propertyData.bedrooms || null,
          bathrooms: propertyData.bathrooms || null,
          sqft: propertyData.squareFeet || 0,
          lot_size_sqft: propertyData.lotSquareFeet || 0,
          property_type:
            propertyData.propertyType || propertyData.propertyUse || null,
          mortgage_balance: propertyData.openMortgageBalance || 0,
          enriched_at: new Date().toISOString(),
        },
        {
          onConflict: "tax_lien_id",
        },
      );

      // Get tax lien data for investment calculations
      const { data: taxLien } = await supabaseAdmin
        .from("tax_liens")
        .select("tax_amount_due, county_id")
        .eq("id", taxLienId)
        .single();

      if (taxLien && propertyData.estimatedValue > 0) {
        // Calculate investment metrics
        const mortgageBalance = propertyData.mortgageBalance || 0;
        const ltv = calculateLTV(
          mortgageBalance,
          taxLien.tax_amount_due,
          propertyData.estimatedValue,
        );
        const equity = calculateEquity(
          propertyData.estimatedValue,
          mortgageBalance,
          taxLien.tax_amount_due,
        );

        // Get county name for scoring
        const { data: county } = await supabaseAdmin
          .from("counties")
          .select("name")
          .eq("id", taxLien.county_id)
          .single();

        const investmentScore = calculateInvestmentScore(
          ltv,
          equity,
          taxLien.tax_amount_due,
          propertyData.estimatedValue,
          propertyData.propertyType || "Unknown",
          county?.name || "Unknown",
        );

        // Save investment score
        await supabaseAdmin.from("investment_scores").upsert(
          {
            tax_lien_id: taxLienId,
            ltv,
            equity_estimate: equity,
            investment_score: investmentScore.score,
            score_breakdown: investmentScore.breakdown,
            calculated_at: new Date().toISOString(),
          },
          {
            onConflict: "tax_lien_id",
          },
        );

        console.log(
          `Property enriched and scored: ${address} (Score: ${investmentScore.score})`,
        );
      }
    } catch (error: any) {
      console.error(`Error enriching property ${address}:`, error.message);

      // Log detailed error information
      if (error.response) {
        console.error("API Response Error:", {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        });
      }

      // Create a basic property record even if API fails
      await supabaseAdmin.from("properties").upsert(
        {
          tax_lien_id: taxLienId,
          enriched_at: new Date().toISOString(),
          enrichment_error: error.message,
        },
        {
          onConflict: "tax_lien_id",
        },
      );

      // Don't throw - continue with next property
      console.log(
        `⚠️ Property ${address} enrichment failed, continuing with next property`,
      );
    }
  }

  async enrichAllProperties(): Promise<void> {
    try {
      console.log("Starting property enrichment for all tax liens...");

      // Get all tax liens that don't have property data yet
      const { data: taxLiens } = await supabaseAdmin
        .from("tax_liens")
        .select(
          `
          id,
          property_address,
          city,
          zip,
          properties(id)
        `,
        )
        .is("properties.id", null)
        .limit(100); // Process in batches

      if (!taxLiens || taxLiens.length === 0) {
        console.log("No properties to enrich");
        return;
      }

      console.log(`Found ${taxLiens.length} properties to enrich`);

      // Process properties in parallel with a delay to avoid rate limits
      const batchSize = 5;
      for (let i = 0; i < taxLiens.length; i += batchSize) {
        const batch = taxLiens.slice(i, i + batchSize);

        await Promise.all(
          batch.map((lien) =>
            this.enrichProperty(
              lien.id,
              lien.property_address,
              lien.city || undefined,
              lien.zip || undefined,
            ),
          ),
        );

        // Add delay between batches to respect API limits
        if (i + batchSize < taxLiens.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log("Property enrichment completed");
    } catch (error) {
      console.error("Error in property enrichment:", error);
      throw error;
    }
  }

  async enrichCountyProperties(countyId: number): Promise<void> {
    try {
      console.log(`Starting property enrichment for county ${countyId}...`);

      const { data: taxLiens } = await supabaseAdmin
        .from("tax_liens")
        .select(
          `
          id,
          property_address,
          city,
          zip,
          properties(id)
        `,
        )
        .eq("county_id", countyId)
        .is("properties.id", null)
        .limit(50);

      if (!taxLiens || taxLiens.length === 0) {
        console.log("No properties to enrich for this county");
        return;
      }

      console.log(
        `Found ${taxLiens.length} properties to enrich for county ${countyId}`,
      );

      await Promise.all(
        taxLiens.map((lien) =>
          this.enrichProperty(
            lien.id,
            lien.property_address,
            lien.city || undefined,
            lien.zip || undefined,
          ),
        ),
      );

      console.log(`Property enrichment completed for county ${countyId}`);
    } catch (error) {
      console.error(`Error enriching county ${countyId} properties:`, error);
      throw error;
    }
  }
}
