import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const countyId = searchParams.get("countyId");
    const sortBy = searchParams.get("sortBy") || "property_confidence";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const limit = parseInt(searchParams.get("limit") || "100");

    console.log(`GET: Fetching tax liens... countyId: ${countyId}, sortBy: ${sortBy}`);

    // Build base query with joins
    let query = supabaseAdmin
      .from("tax_liens")
      .select(
        `
        *,
        county:counties(name),
        property:properties(*),
        investment_score:investment_scores(*)
      `,
      );

    // Filter by county if specified
    if (countyId && countyId !== "all") {
      query = query.eq("county_id", parseInt(countyId));
    }

    let taxLiens: any[] = [];

    // Handle sorting by nested fields
    if (sortBy === "property_confidence" || sortBy === "investment_score") {
      // Fetch all matching records first (we'll sort and paginate in memory)
      const { data: allTaxLiens, error: allError } = await query;

      if (allError) {
        console.error("Error fetching tax liens:", allError);
        return NextResponse.json(
          {
            success: false,
            error: allError.message,
          },
          { status: 500 }
        );
      }

      if (allTaxLiens) {
        // Normalize investment_score data
        const normalized = allTaxLiens.map((lien: any) => {
          if (Array.isArray(lien.investment_score)) {
            lien.investment_score = lien.investment_score[0] || null;
          }
          return lien;
        });

        // Sort in memory
        normalized.sort((a: any, b: any) => {
          let aValue: number | null = null;
          let bValue: number | null = null;

          if (sortBy === "property_confidence") {
            aValue = a.property?.confidence ?? null;
            bValue = b.property?.confidence ?? null;
          } else if (sortBy === "investment_score") {
            aValue = a.investment_score?.investment_score ?? null;
            bValue = b.investment_score?.investment_score ?? null;
          }

          if (aValue === null && bValue === null) return 0;
          if (aValue === null) return 1;
          if (bValue === null) return -1;

          return sortOrder === "desc" ? bValue - aValue : aValue - bValue;
        });

        // Filter out records without investment_score
        taxLiens = normalized
          .filter((lien: any) => lien.investment_score?.investment_score !== undefined && lien.investment_score?.investment_score !== null)
          .slice(0, limit);
        console.log(`Sorted by ${sortBy} in memory, returning ${taxLiens.length} records (filtered to only include records with investment scores)`);
      }
    } else {
      // For non-nested fields, fetch all records first, then sort in memory
      // This avoids issues with ordering on joined tables
      const { data: allTaxLiens, error: allError } = await query;

      if (allError) {
        console.error("Error fetching tax liens:", allError);
        return NextResponse.json(
          {
            success: false,
            error: allError.message,
          },
          { status: 500 }
        );
      }

      taxLiens = allTaxLiens || [];
      
      // Normalize investment_score data
      taxLiens = taxLiens.map((lien: any) => {
        if (Array.isArray(lien.investment_score)) {
          lien.investment_score = lien.investment_score[0] || null;
        }
        return lien;
      });

      // Filter out records without investment_score
      taxLiens = taxLiens.filter(
        (lien: any) => lien.investment_score?.investment_score !== undefined && lien.investment_score?.investment_score !== null
      );

      // Sort in memory by the requested field
      taxLiens.sort((a: any, b: any) => {
        let aValue: any = a[sortBy];
        let bValue: any = b[sortBy];

        // Handle null/undefined values
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        // Handle date strings
        if (sortBy === "scraped_at" || sortBy === "sale_date") {
          aValue = new Date(aValue).getTime();
          bValue = new Date(bValue).getTime();
        }

        // Handle numbers
        if (typeof aValue === "number" && typeof bValue === "number") {
          return sortOrder === "desc" ? bValue - aValue : aValue - bValue;
        }

        // Handle strings
        if (typeof aValue === "string" && typeof bValue === "string") {
          return sortOrder === "desc" 
            ? bValue.localeCompare(aValue)
            : aValue.localeCompare(bValue);
        }

        return 0;
      });

      // Apply limit after sorting
      taxLiens = taxLiens.slice(0, limit);

      console.log(`Query succeeded: ${taxLiens.length} records returned (sorted by ${sortBy}, filtered to only include records with investment scores)`);
    }

    // Calculate total tax value
    const totalTaxValue = taxLiens.reduce(
      (sum, lien) => sum + (lien.tax_amount_due || 0),
      0
    );

    return NextResponse.json({
      success: true,
      taxLiens: taxLiens || [],
      totalTaxValue,
      count: taxLiens.length,
    });
  } catch (error) {
    console.error("Tax liens API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
