import { NextRequest, NextResponse } from "next/server";
import { RealEstateService } from "@/lib/RealEstateService";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { countyId, taxLienId } = body;

    const realEstateService = new RealEstateService();

    if (taxLienId) {
      // Enrich specific property
      const { data: taxLien } = await supabaseAdmin
        .from("tax_liens")
        .select("parcel_id")
        .eq("id", taxLienId)
        .single();

      if (!taxLien) {
        return NextResponse.json(
          { success: false, error: "Tax lien not found" },
          { status: 404 },
        );
      }

      await realEstateService.enrichProperty(
        taxLienId,
        taxLien.parcel_id
      );

      return NextResponse.json({
        success: true,
        message: "Property enriched successfully",
      });
    } else if (countyId) {
      // Enrich all properties in a county
      await realEstateService.enrichCountyProperties(countyId);
      return NextResponse.json({
        success: true,
        message: `Properties enriched for county ${countyId}`,
      });
    } else {
      // Enrich all properties
      await realEstateService.enrichAllProperties();
      return NextResponse.json({
        success: true,
        message: "All properties enriched successfully",
      });
    }
  } catch (error) {
    console.error("Property enrichment API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
