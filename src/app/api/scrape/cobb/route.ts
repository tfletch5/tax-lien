import { NextRequest, NextResponse } from "next/server";
import { CobbScraper } from "@/lib/scrapers/CobbScraper";

export async function POST(request: NextRequest) {
  try {
    console.log("Starting Cobb County tax lien scraping...");

    // Check if enrichment should be enabled (default: true)
    let enableEnrichment = true;
    try {
      const body = await request.json();
      enableEnrichment = body.enableEnrichment !== false; // Default to true
    } catch {
      // No body provided, use default
      enableEnrichment = true;
    }

    const scraper = new CobbScraper(3, "Cobb", enableEnrichment);
    const liens = await scraper.scrape();

    console.log(
      `Successfully scraped ${liens.length} tax liens from Cobb County`,
    );

    return NextResponse.json({
      success: true,
      message: `Cobb County scraping completed`,
      count: liens.length,
      liens: liens.slice(0, 5), // Return first 5 for preview
    });
  } catch (error) {
    console.error("Cobb scraping error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
