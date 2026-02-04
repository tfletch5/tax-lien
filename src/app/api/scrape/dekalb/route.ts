import { NextRequest, NextResponse } from "next/server";
import { DeKalbScraper } from "@/lib/scrapers/DeKalbScraper";

export async function POST(request: NextRequest) {
  try {
    console.log("Starting DeKalb County tax lien scraping...");

    const scraper = new DeKalbScraper(1, "DeKalb");
    const liens = await scraper.scrape();

    console.log(
      `Successfully scraped ${liens.length} tax liens from DeKalb County`,
    );

    return NextResponse.json({
      success: true,
      message: `DeKalb County scraping completed`,
      count: liens.length,
      liens: liens.slice(0, 5), // Return first 5 for preview
    });
  } catch (error) {
    console.error("DeKalb scraping error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");

    // Get query parameters for pagination and sorting
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const sortBy = searchParams.get("sortBy") || "scraped_at";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    // Search parameters
    const address = searchParams.get("address") || "";
    const owner = searchParams.get("owner") || "";
    const taxDueOperator = searchParams.get("taxDueOperator") || "all";
    const taxDueValue = searchParams.get("taxDueValue") || "";

    const offset = (page - 1) * limit;

    console.log(
      `GET: Fetching DeKalb tax liens... page ${page}, limit ${limit}`,
    );

    // Build base query with search filters and joins
    // Always include joins to get property and investment_score data
    let query = supabaseAdmin
      .from("tax_liens")
      .select(
        `
        *,
        county:counties(name),
        property:properties(*),
        investment_score:investment_scores(*)
      `,
      )
      .eq("county_id", 1); // DeKalb County ID

    // Apply search filters
    if (address) {
      query = query.ilike("property_address", `%${address}%`);
    }
    if (owner) {
      query = query.ilike("owner_name", `%${owner}%`);
    }
    if (taxDueOperator !== "all" && taxDueValue) {
      const taxAmount = parseFloat(taxDueValue);
      if (!isNaN(taxAmount)) {
        switch (taxDueOperator) {
          case "gt":
            query = query.gt("tax_amount_due", taxAmount);
            break;
          case "lt":
            query = query.lt("tax_amount_due", taxAmount);
            break;
          case "eq":
            query = query.eq("tax_amount_due", taxAmount);
            break;
        }
      }
    }

    // Get total count for pagination with filters
    const { count: totalCount } = await supabaseAdmin
      .from("tax_liens")
      .select("*", { count: "exact", head: true })
      .eq("county_id", 1);

    // Apply the same filters to count query
    let countQuery = supabaseAdmin
      .from("tax_liens")
      .select("*", { count: "exact", head: true })
      .eq("county_id", 1);

    if (address) {
      countQuery = countQuery.ilike("property_address", `%${address}%`);
    }
    if (owner) {
      countQuery = countQuery.ilike("owner_name", `%${owner}%`);
    }
    if (taxDueOperator !== "all" && taxDueValue) {
      const taxAmount = parseFloat(taxDueValue);
      if (!isNaN(taxAmount)) {
        switch (taxDueOperator) {
          case "gt":
            countQuery = countQuery.gt("tax_amount_due", taxAmount);
            break;
          case "lt":
            countQuery = countQuery.lt("tax_amount_due", taxAmount);
            break;
          case "eq":
            countQuery = countQuery.eq("tax_amount_due", taxAmount);
            break;
        }
      }
    }

    const { count: filteredCount } = await countQuery;

    // Get total tax value for all properties (not filtered)
    const { data: allTaxLiens, error: taxValueError } = await supabaseAdmin
      .from("tax_liens")
      .select("tax_amount_due")
      .eq("county_id", 1);

    const totalTaxValue =
      allTaxLiens?.reduce((sum, lien) => sum + (lien.tax_amount_due || 0), 0) ||
      0;

    // Get filtered tax value (for search results)
    let filteredTaxValueQuery = supabaseAdmin
      .from("tax_liens")
      .select("tax_amount_due")
      .eq("county_id", 1);

    if (address) {
      filteredTaxValueQuery = filteredTaxValueQuery.ilike(
        "property_address",
        `%${address}%`,
      );
    }
    if (owner) {
      filteredTaxValueQuery = filteredTaxValueQuery.ilike(
        "owner_name",
        `%${owner}%`,
      );
    }
    if (taxDueOperator !== "all" && taxDueValue) {
      const taxAmount = parseFloat(taxDueValue);
      if (!isNaN(taxAmount)) {
        switch (taxDueOperator) {
          case "gt":
            filteredTaxValueQuery = filteredTaxValueQuery.gt(
              "tax_amount_due",
              taxAmount,
            );
            break;
          case "lt":
            filteredTaxValueQuery = filteredTaxValueQuery.lt(
              "tax_amount_due",
              taxAmount,
            );
            break;
          case "eq":
            filteredTaxValueQuery = filteredTaxValueQuery.eq(
              "tax_amount_due",
              taxAmount,
            );
            break;
        }
      }
    }

    const { data: filteredTaxLiens } = await filteredTaxValueQuery;
    const filteredTaxValue =
      filteredTaxLiens?.reduce(
        (sum, lien) => sum + (lien.tax_amount_due || 0),
        0,
      ) || 0;

    // Apply sorting and pagination to main query
    // Note: Can't sort by nested fields directly, so we'll handle property_confidence and investment_score separately
    let sortField = sortBy;
    if (sortBy === "property_confidence" || sortBy === "investment_score") {
      sortField = "scraped_at"; // Use a default sort for the query, we'll sort by nested field after
    }
    
    let taxLiens: any[] = [];

    // Handle sorting by nested property fields (like confidence or investment_score)
    if (sortBy === "property_confidence" || sortBy === "investment_score") {
      // Fetch all matching records first (we'll sort and paginate in memory)
      const { data: allTaxLiens, error: allError } = await query;
      
      if (!allError && allTaxLiens) {
        // Normalize investment_score data first (handle case where it might be an array)
        const normalizedAllTaxLiens = allTaxLiens.map((lien: any) => {
          // If investment_score is an array, take the first element
          if (Array.isArray(lien.investment_score)) {
            lien.investment_score = lien.investment_score[0] || null;
          }
          return lien;
        });
        
        // Sort by the appropriate nested field
        normalizedAllTaxLiens.sort((a: any, b: any) => {
          let aValue: number | null = null;
          let bValue: number | null = null;
          
          if (sortBy === "property_confidence") {
            aValue = a.property?.confidence ?? null;
            bValue = b.property?.confidence ?? null;
          } else if (sortBy === "investment_score") {
            aValue = a.investment_score?.investment_score ?? null;
            bValue = b.investment_score?.investment_score ?? null;
          }
          
          // Handle null values - put them at the end
          if (aValue === null && bValue === null) return 0;
          if (aValue === null) return 1; // a goes to end
          if (bValue === null) return -1; // b goes to end
          
          // Sort by value
          if (sortOrder === "desc") {
            return bValue - aValue; // Higher value first
          } else {
            return aValue - bValue; // Lower value first
          }
        });
        
        // Apply pagination after sorting
        taxLiens = normalizedAllTaxLiens.slice(offset, offset + limit);
        console.log(`Sorted by ${sortBy} in memory`);
      } else {
        console.error("Error fetching all records for confidence sort:", allError);
        if (allError) {
          return NextResponse.json({
            county: "DeKalb",
            taxLiens: [],
            recentLogs: [],
            totalProperties: 0,
            pagination: {
              page,
              limit,
              totalCount: 0,
              totalPages: 0,
            },
            error: allError.message,
          });
        }
      }
    } else {
      // Normal sorting for non-nested fields
      const { data: queryTaxLiens, error: queryError } = await query
        .order(sortField, { ascending: sortOrder === "asc" })
        .range(offset, offset + limit - 1);

      if (queryError) {
        console.error("Query failed:", queryError);
        return NextResponse.json({
          county: "DeKalb",
          taxLiens: [],
          recentLogs: [],
          totalProperties: 0,
          pagination: {
            page,
            limit,
            totalCount: 0,
            totalPages: 0,
          },
          error: queryError.message,
        });
      }

      taxLiens = queryTaxLiens || [];
      console.log(`Query succeeded: ${taxLiens.length} records returned`);
      
      // Normalize investment_score data (handle case where it might be an array)
      taxLiens = taxLiens.map((lien: any) => {
        // If investment_score is an array, take the first element
        if (Array.isArray(lien.investment_score)) {
          lien.investment_score = lien.investment_score[0] || null;
        }
        return lien;
      });
      
      // Debug: Check if investment_score data is present
      if (taxLiens.length > 0) {
        const sampleWithScore = taxLiens.find((l: any) => l.investment_score);
        const sampleWithoutScore = taxLiens.find((l: any) => !l.investment_score);
        if (sampleWithScore) {
          console.log('Sample with investment_score:', {
            ltv: sampleWithScore.investment_score?.ltv,
            investment_score: sampleWithScore.investment_score?.investment_score,
            hasLTV: sampleWithScore.investment_score?.ltv !== undefined && sampleWithScore.investment_score?.ltv !== null
          });
        }
        console.log(`Records with investment_score: ${taxLiens.filter((l: any) => l.investment_score).length}/${taxLiens.length}`);
        console.log(`Records with LTV: ${taxLiens.filter((l: any) => l.investment_score?.ltv !== undefined && l.investment_score?.ltv !== null).length}/${taxLiens.length}`);
      }
    }

    // Get scrape logs for DeKalb
    const { data: scrapeLogs } = await supabaseAdmin
      .from("scrape_logs")
      .select("*")
      .eq("county_id", 1)
      .order("started_at", { ascending: false })
      .limit(5);

    // If sorting by confidence, we need to recalculate total count after filtering
    // (since we fetched all records for sorting)
    let finalTotalCount = filteredCount || 0;
    let finalTotalPages = Math.ceil(finalTotalCount / limit);
    
    // If we sorted by confidence in memory, the count is already correct
    if (sortBy === "property_confidence" && taxLiens) {
      // Count is already filtered, just calculate pages
      finalTotalPages = Math.ceil(finalTotalCount / limit);
    }

    console.log(
      `GET: Returning ${taxLiens?.length || 0} tax liens for DeKalb (page ${page} of ${finalTotalPages})`,
    );

    return NextResponse.json({
      county: "DeKalb",
      taxLiens: taxLiens || [],
      recentLogs: scrapeLogs || [],
      totalProperties: totalCount || 0,
      totalTaxValue: filteredTaxValue,
      pagination: {
        page,
        limit,
        totalCount: finalTotalCount,
        totalPages: finalTotalPages,
      },
    });
  } catch (error) {
    console.error("DeKalb status API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
