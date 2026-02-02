import { NextRequest, NextResponse } from "next/server";
import { RealEstateService } from "@/lib/RealEstateService";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { countyId } = body;

    console.log("Starting property enrichment...", { countyId });

    const realEstateService = new RealEstateService();

    if (countyId) {
      // Enrich specific county properties
      await realEstateService.enrichCountyProperties(countyId);
      return NextResponse.json({
        success: true,
        message: `Property enrichment completed for county ${countyId}`,
      });
    } else {
      // Enrich all properties
      await realEstateService.enrichAllProperties();
      return NextResponse.json({
        success: true,
        message: "Property enrichment completed for all properties",
      });
    }
  } catch (error) {
    console.error("Property enrichment error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    // Return enrichment status
    const { supabaseAdmin } = await import("@/lib/supabase");

    const { count: enrichedCount } = await supabaseAdmin
      .from("properties")
      .select("id", { count: "exact", head: true })
      .not("estimated_value", "is", null);

    const { count: totalCount } = await supabaseAdmin
      .from("tax_liens")
      .select("id", { count: "exact", head: true });

    const { count: scoredCount } = await supabaseAdmin
      .from("investment_scores")
      .select("id", { count: "exact", head: true });

    return NextResponse.json({
      totalProperties: totalCount || 0,
      enrichedProperties: enrichedCount || 0,
      scoredProperties: scoredCount || 0,
      enrichmentRate: totalCount
        ? Math.round(((enrichedCount || 0) / totalCount) * 100)
        : 0,
    });
  } catch (error) {
    console.error("Error getting enrichment status:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
