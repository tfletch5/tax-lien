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

    const offset = (page - 1) * limit;

    console.log(
      `GET: Fetching DeKalb tax liens... page ${page}, limit ${limit}`,
    );

    // Get total count for pagination
    const { count: totalCount } = await supabaseAdmin
      .from("tax_liens")
      .select("*", { count: "exact", head: true })
      .eq("county_id", 1);

    // Get total tax value for all properties (not just current page)
    const { data: allTaxLiens, error: taxValueError } = await supabaseAdmin
      .from("tax_liens")
      .select("tax_amount_due")
      .eq("county_id", 1);

    const totalTaxValue =
      allTaxLiens?.reduce((sum, lien) => sum + (lien.tax_amount_due || 0), 0) ||
      0;

    // First try a simple query without joins with pagination
    const { data: simpleTaxLiens, error: simpleError } = await supabaseAdmin
      .from("tax_liens")
      .select("*")
      .eq("county_id", 1) // DeKalb County ID
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
      const { data: complexTaxLiens, error: complexError } = await supabaseAdmin
        .from("tax_liens")
        .select(
          `
          *,
          county:counties(name),
          property:properties(*),
          investment_score:investment_scores(*)
        `,
        )
        .eq("county_id", 1)
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

    const totalPages = Math.ceil((totalCount || 0) / limit);

    console.log(
      `GET: Returning ${taxLiens?.length || 0} tax liens for DeKalb (page ${page} of ${totalPages})`,
    );

    return NextResponse.json({
      county: "DeKalb",
      taxLiens: taxLiens || [],
      recentLogs: scrapeLogs || [],
      totalProperties: totalCount || 0,
      totalTaxValue: totalTaxValue,
      pagination: {
        page,
        limit,
        totalCount: totalCount || 0,
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
