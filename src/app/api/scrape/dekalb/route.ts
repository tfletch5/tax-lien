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

    // Build base query with search filters
    let query = supabaseAdmin.from("tax_liens").select("*").eq("county_id", 1); // DeKalb County ID

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
    const { data: simpleTaxLiens, error: simpleError } = await query
      .order(sortBy, { ascending: sortOrder === "asc" })
      .range(offset, offset + limit - 1);

    console.log("Simple query result:", {
      count: simpleTaxLiens?.length || 0,
      error: simpleError,
      totalCount,
    });

    if (simpleError) {
      console.error("Simple query failed:", simpleError);
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
        error: simpleError.message,
      });
    }

    // If simple query works, try the complex query
    let taxLiens = simpleTaxLiens;

    if (simpleTaxLiens && simpleTaxLiens.length > 0) {
      // Build complex query with same filters
      let complexQuery = supabaseAdmin
        .from("tax_liens")
        .select(
          `
          *,
          county:counties(name),
          property:properties(*),
          investment_score:investment_scores(*)
        `,
        )
        .eq("county_id", 1);

      // Apply same search filters to complex query
      if (address) {
        complexQuery = complexQuery.ilike("property_address", `%${address}%`);
      }
      if (owner) {
        complexQuery = complexQuery.ilike("owner_name", `%${owner}%`);
      }
      if (taxDueOperator !== "all" && taxDueValue) {
        const taxAmount = parseFloat(taxDueValue);
        if (!isNaN(taxAmount)) {
          switch (taxDueOperator) {
            case "gt":
              complexQuery = complexQuery.gt("tax_amount_due", taxAmount);
              break;
            case "lt":
              complexQuery = complexQuery.lt("tax_amount_due", taxAmount);
              break;
            case "eq":
              complexQuery = complexQuery.eq("tax_amount_due", taxAmount);
              break;
          }
        }
      }

      const { data: complexTaxLiens, error: complexError } = await complexQuery
        .order(sortBy, { ascending: sortOrder === "asc" })
        .range(offset, offset + limit - 1);

      if (!complexError) {
        taxLiens = complexTaxLiens;
        console.log("Complex query succeeded");
      } else {
        console.log(
          "Complex query failed, using simple results:",
          complexError.message,
        );
      }
    }

    // Get scrape logs for DeKalb
    const { data: scrapeLogs } = await supabaseAdmin
      .from("scrape_logs")
      .select("*")
      .eq("county_id", 1)
      .order("started_at", { ascending: false })
      .limit(5);

    const totalPages = Math.ceil((filteredCount || 0) / limit);

    console.log(
      `GET: Returning ${taxLiens?.length || 0} tax liens for DeKalb (page ${page} of ${totalPages})`,
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
        totalCount: filteredCount || 0,
        totalPages,
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
