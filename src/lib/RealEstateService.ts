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

  /**
   * Enrich property by parcel ID and return property data without saving to database.
   * Used during scraping to validate properties before saving.
   * @param parcelId The parcel ID (APN)
   * @param address Optional address for fallback search
   * @returns Property data object if valid (assessedImprovementValue > 0), null otherwise
   */
  async enrichPropertyByParcel(
    parcelId: string,
    address?: string
  ): Promise<{ propertyData: any; isValid: boolean } | null> {
    try {
      console.log(`Enriching property by parcel: ${parcelId}`);

      const urls = {
        "search": {
          url: `${this.baseUrl}/PropertySearch`,
          params: { apn: parcelId, state: "GA" }
        },
      };
      
      let propertyData: any = null;
      let lastError: any = null;

      try {
        console.log(`Trying endpoint: ${urls.search.url} with APN: ${parcelId}`);

        const response = await axios.post(
          urls.search.url,
          urls.search.params,
          {
            headers: {
              "x-api-key": this.apiKey,
            },
          }
        );

        console.log(`✅ Success with ${urls.search.url}:`, response.status);

        // Handle the RealEstateAPI response format
        if (response.data && response.data.data) {
          // Check if data is an array (PropertySearch might return multiple results)
          if (Array.isArray(response.data.data)) {
            // Use the first property from the array
            propertyData = response.data.data[0];
          } else {
            propertyData = response.data.data;
          }
        }

        if (!propertyData) {
          throw new Error("Failed to get property data");
        }
      } catch (error: any) {
        console.log(
          `❌ Failed with ${urls.search.url}:`,
          error.response?.status || error.message,
        );
        lastError = error;

        // If we have an address, try searching by address as fallback
        if (address && error.response?.status === 404) {
          try {
            console.log(`Trying fallback search by address: ${address}`);
            const addressResponse = await axios.post(
              urls.search.url,
              { address: address, state: "GA" },
              {
                headers: {
                  "x-api-key": this.apiKey,
                },
              }
            );

            if (addressResponse.data && addressResponse.data.data) {
              if (Array.isArray(addressResponse.data.data)) {
                propertyData = addressResponse.data.data[0];
              } else {
                propertyData = addressResponse.data.data;
              }
            }
          } catch (addressError) {
            console.log(`Fallback address search also failed`);
          }
        }

        if (!propertyData && error.response?.status !== 404) {
          // For non-404 errors, don't continue
          throw error;
        }
      }

      if (!propertyData) {
        console.log(`⚠️ No property data found for parcel ${parcelId}`);
        return null;
      }

      // Check if assessedImprovementValue is 0 - if so, property is not valid
      // Use nullish coalescing (??) instead of || to properly handle 0 values
      // If assessedImprovementValue is 0, we want to detect it, not skip to the next field
      const assessedImprovementValue = 
        propertyData.assessedImprovementValue ?? 
        propertyData.assessed_improvement_value ?? 
        0;
      
      const isValid = assessedImprovementValue !== 0 && assessedImprovementValue !== "0";

      if (!isValid) {
        console.log(`⚠️ Property ${parcelId} has assessedImprovementValue = 0, skipping`);
        return { propertyData, isValid: false };
      }

      console.log(`✅ Property ${parcelId} is valid (assessedImprovementValue > 0)`);
      return { propertyData, isValid: true };
    } catch (error) {
      console.error(`Error enriching property by parcel ${parcelId}:`, error);
      return null;
    }
  }

  async enrichProperty(
    taxLienId: string,
    parcelId: string
  ): Promise<void> {
    try {
      console.log(`Enriching property: ${parcelId}`);

      const urls = {
        "search": {
          url: `${this.baseUrl}/PropertySearch`,
          params: { apn: parcelId, state: "GA" }
        },
        "valuation": {
          url: `${this.baseUrl}/PropertyAvm`,
          params: {}
        },
      }
      //  assessedImprovementValue if this 0 skip it
      
      let propertyData: any = null;
      let lastError: any = null;

      try {
        console.log(`Trying endpoint: ${urls.search.url}`);

        const response = await axios.post(
          urls.search.url,
          urls.search.params,
          {
            headers: {
              "x-api-key": this.apiKey,
            },
          }
        );

        console.log(`✅ Success with ${urls.search.url}:`, response.status);
        console.log(`Response data structure:`, JSON.stringify(response.data, null, 2));

        // Handle the RealEstateAPI response format
        if (response.data && response.data.data) {
          // Check if data is an array (PropertySearch might return multiple results)
          if (Array.isArray(response.data.data)) {
            // Use the first property from the array
            propertyData = response.data.data[0];
          } else {
            propertyData = response.data.data;
          }
        }

        if (!propertyData) {
          throw new Error("Failed to get property data");
        }
      } catch (error: any) {
        console.log(
          `❌ Failed with ${urls.search.url}:`,
          error.response?.status || error.message,
        );
        lastError = error;

        if (error.response?.status !== 404) {
          // For non-404 errors, don't try other endpoints
          throw error;
        }
      }

      if (!propertyData) {
        throw lastError || new Error("All API endpoints failed");
      }

      console.log(`Property data:`, JSON.stringify(propertyData, null, 2));

      // Skip if assessedImprovementValue is 0 (as per comment)
      if (propertyData.assessedImprovementValue === 0 || propertyData.assessedImprovementValue === "0") {
        console.log(`⚠️ Skipping property with assessedImprovementValue = 0`);
        return;
      }

      // Map API response fields to database fields
      // The API field names might vary, so we'll try multiple possible field names
      const propertyRecord: any = {
        tax_lien_id: taxLienId,
        enriched_at: new Date().toISOString(),
      };

      // Estimated value - try multiple field names
      propertyRecord.estimated_value = 
        propertyData.estimatedValue || 
        propertyData.estimated_value || 
        propertyData.avm ||
        propertyData.assessedValue ||
        0;

      // Last sale price
      propertyRecord.last_sale_price = 
        propertyData.lastSaleAmount ? parseFloat(propertyData.lastSaleAmount) :
        propertyData.lastSalePrice ? parseFloat(propertyData.lastSalePrice) :
        propertyData.last_sale_price ? parseFloat(propertyData.last_sale_price) :
        0;

      // Last sale date
      propertyRecord.last_sale_date = 
        propertyData.lastSaleDate || 
        propertyData.last_sale_date || 
        null;

      // Year built
      propertyRecord.year_built = 
        propertyData.yearBuilt || 
        propertyData.year_built || 
        null;

      // Bedrooms
      propertyRecord.bedrooms = 
        propertyData.bedrooms || 
        propertyData.bedroomCount ||
        null;

      // Bathrooms
      propertyRecord.bathrooms = 
        propertyData.bathrooms || 
        propertyData.bathroomCount ||
        null;

      // Square feet
      propertyRecord.sqft = 
        propertyData.squareFeet || 
        propertyData.sqft || 
        propertyData.square_feet ||
        propertyData.livingArea ||
        0;

      // Lot size
      propertyRecord.lot_size_sqft = 
        propertyData.lotSquareFeet || 
        propertyData.lot_size_sqft ||
        propertyData.lotSize ||
        0;

      // Property type
      propertyRecord.property_type = 
        propertyData.propertyType || 
        propertyData.propertyUse || 
        propertyData.property_type ||
        null;

      // Mortgage balance
      propertyRecord.mortgage_balance = 
        propertyData.openMortgageBalance ? parseFloat(propertyData.openMortgageBalance) :
        propertyData.mortgageBalance ? parseFloat(propertyData.mortgageBalance) :
        propertyData.mortgage_balance ? parseFloat(propertyData.mortgage_balance) :
        0;

      // Update tax_liens table with address, city, state, and zip from property data
      // Try multiple possible field names from the API response
      const propertyAddress = 
        propertyData.address?.street || null;
      const city = propertyData.address?.city || propertyData.cityName || propertyData.city || null;
      const state = propertyData.address?.state || propertyData.stateCode || propertyData.state || "GA"; // Default to GA if not found
      const zip = propertyData.address?.zip || propertyData.zipCode || propertyData.postalCode || propertyData.zip || null;
      
      if (propertyAddress || city || state || zip) {
        const taxLienUpdate: any = {};
        
        if (propertyAddress) {
          taxLienUpdate.property_address = propertyAddress;
        }
        if (city) {
          taxLienUpdate.city = city;
        }
        if (state) {
          taxLienUpdate.state = state;
        }
        if (zip) {
          taxLienUpdate.zip = zip;
        }
        
        // Update tax_liens table
        const { error: taxLienUpdateError } = await supabaseAdmin
          .from("tax_liens")
          .update(taxLienUpdate)
          .eq("id", taxLienId);
        
        if (taxLienUpdateError) {
          console.error(`Error updating tax_liens with address data:`, taxLienUpdateError);
          // Don't throw - this is not critical, continue with property enrichment
        } else {
          console.log(`✅ Updated tax_liens with address/city/state/zip:`, taxLienUpdate);
        }
      }

      console.log(`Saving property record:`, JSON.stringify(propertyRecord, null, 2));

      // Try upsert first (if unique constraint exists)
      let { error: upsertError } = await supabaseAdmin.from("properties").upsert(
        propertyRecord,
        {
          onConflict: "tax_lien_id",
        },
      );

      // If upsert fails due to missing constraint, fall back to manual check/update
      if (upsertError && upsertError.code === '42P10') {
        console.log(`Unique constraint not found, using manual update/insert approach`);
        
        // Check if property record already exists
        const { data: existingProperty } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("tax_lien_id", taxLienId)
          .single();

        if (existingProperty) {
          // Update existing record
          const { error: updateError } = await supabaseAdmin
            .from("properties")
            .update(propertyRecord)
            .eq("tax_lien_id", taxLienId);
          
          if (updateError) {
            console.error(`Error updating property:`, updateError);
            throw updateError;
          }
          console.log(`✅ Property data updated successfully for tax_lien_id: ${taxLienId}`);
        } else {
          // Insert new record
          const { error: insertError } = await supabaseAdmin
            .from("properties")
            .insert(propertyRecord);
          
          if (insertError) {
            console.error(`Error inserting property:`, insertError);
            throw insertError;
          }
          console.log(`✅ Property data inserted successfully for tax_lien_id: ${taxLienId}`);
        }
      } else if (upsertError) {
        // Other error occurred
        console.error(`Error saving property to database:`, upsertError);
        throw upsertError;
      } else {
        // Upsert succeeded
        console.log(`✅ Property data saved successfully for tax_lien_id: ${taxLienId}`);
      }

      let valuationData: any = null;

      try {
        console.log(`Trying endpoint: ${urls.valuation.url}`);
        console.log(`Property data keys:`, Object.keys(propertyData));
        console.log(`Property data.id:`, propertyData.id);
        console.log(`Property data.address:`, propertyData.address);

        const response = await axios.post(
          urls.valuation.url,
          { id: propertyData.id },
          {
            headers: {
              "x-api-key": this.apiKey,
            },
          }
        );

        if (response.data && response.data.data) {
          valuationData = response.data.data;
        }

        if (!valuationData) {
          throw new Error("Failed to get valuation data");
        }

        // Update properties table with valuation data
        // API returns: avm, avmMin, avmMax, confidence
        const updateData: any = {
          tax_lien_id: taxLienId,
          enriched_at: new Date().toISOString(),
        };

        // Update estimated_value with AVM (Automated Valuation Model) value
        if (valuationData.avm) {
          updateData.estimated_value = parseFloat(valuationData.avm);
        }

        // Save AVM range and confidence
        if (valuationData.avmMin) {
          updateData.avm_min = parseFloat(valuationData.avmMin);
        }
        if (valuationData.avmMax) {
          updateData.avm_max = parseFloat(valuationData.avmMax);
        }
        if (valuationData.confidence) {
          updateData.confidence = parseInt(valuationData.confidence, 10);
        }

        // Save valuation data to properties table
        await supabaseAdmin.from("properties").upsert(
          updateData,
          {
            onConflict: "tax_lien_id",
          },
        );

        console.log(
          `✅ Valuation data saved for property: ${parcelId} (AVM: $${valuationData.avm}, Confidence: ${valuationData.confidence}%)`,
        );
        
      } catch (error: any) {
        console.log(
          `⚠️ Failed to get valuation data:`,
          error.response?.status || error.message,
        );
        if (error.response?.data) {
          console.log(`Valuation API error details:`, JSON.stringify(error.response.data, null, 2));
        }
        // Don't throw - valuation is optional, continue with property data we already have
      }

      // Calculate investment metrics (LTV, equity, investment score)
      try {
        // Get tax lien data for investment calculations
        const { data: taxLien } = await supabaseAdmin
          .from("tax_liens")
          .select("tax_amount_due, county_id")
          .eq("id", taxLienId)
          .single();

        // Get the saved property data to use for calculations
        const { data: savedProperty } = await supabaseAdmin
          .from("properties")
          .select("estimated_value, mortgage_balance, property_type")
          .eq("tax_lien_id", taxLienId)
          .single();

        if (taxLien && savedProperty && savedProperty.estimated_value && savedProperty.estimated_value > 0) {
          // Calculate investment metrics
          const mortgageBalance = savedProperty.mortgage_balance || 0;
          const estimatedValue = savedProperty.estimated_value;
          const taxAmount = taxLien.tax_amount_due || 0;

          const ltv = calculateLTV(
            mortgageBalance,
            taxAmount,
            estimatedValue,
          );
          
          const equity = calculateEquity(
            estimatedValue,
            mortgageBalance,
            taxAmount,
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
            taxAmount,
            estimatedValue,
            savedProperty.property_type || "Unknown",
            county?.name || "Unknown",
          );

          // Save investment score
          const scoreData = {
            tax_lien_id: taxLienId,
            ltv,
            equity_estimate: equity,
            investment_score: investmentScore.score,
            score_breakdown: investmentScore.breakdown,
            calculated_at: new Date().toISOString(),
          };

          // Try upsert first (if unique constraint exists)
          let { error: scoreError } = await supabaseAdmin.from("investment_scores").upsert(
            scoreData,
            {
              onConflict: "tax_lien_id",
            },
          );

          // If upsert fails due to missing constraint, fall back to manual check/update
          if (scoreError && scoreError.code === '42P10') {
            console.log(`Unique constraint not found on investment_scores, using manual update/insert`);
            
            // Check if investment score already exists
            const { data: existingScore } = await supabaseAdmin
              .from("investment_scores")
              .select("id")
              .eq("tax_lien_id", taxLienId)
              .single();

            if (existingScore) {
              // Update existing record
              const { error: updateError } = await supabaseAdmin
                .from("investment_scores")
                .update(scoreData)
                .eq("tax_lien_id", taxLienId);
              
              scoreError = updateError;
            } else {
              // Insert new record
              const { error: insertError } = await supabaseAdmin
                .from("investment_scores")
                .insert(scoreData);
              
              scoreError = insertError;
            }
          }

          if (scoreError) {
            console.error(`Error saving investment score:`, scoreError);
          } else {
            console.log(
              `✅ Investment score calculated: LTV=${ltv.toFixed(2)}%, Equity=$${equity.toFixed(2)}, Score=${investmentScore.score}`,
            );
          }
        } else {
          console.log(`⚠️ Skipping investment score calculation - missing required data (taxLien: ${!!taxLien}, property: ${!!savedProperty}, estimatedValue: ${savedProperty?.estimated_value})`);
        }
      } catch (error: any) {
        console.error(`Error calculating investment score:`, error.message);
        // Don't throw - investment score calculation is optional
      }

    } catch (error: any) {
      console.error(`Error enriching property ${parcelId}:`, error.message);

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
        `⚠️ Property ${parcelId} enrichment failed, continuing with next property`,
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
          parcel_id,
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
              lien.parcel_id
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
          parcel_id,
          properties(id)
        `,
        )
        .eq("county_id", countyId)
        .is("properties.id", null);

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
            lien.parcel_id,
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
