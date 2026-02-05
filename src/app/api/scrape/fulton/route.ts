import { NextRequest, NextResponse } from "next/server";
import { FultonScraper } from "@/lib/scrapers/FultonScraper";

export async function POST(request: NextRequest) {
  try {
    console.log("Starting Fulton County tax lien scraping...");

    // Check if enrichment should be enabled (default: true)
    let enableEnrichment = true;
    try {
      const body = await request.json();
      enableEnrichment = body.enableEnrichment !== false; // Default to true
    } catch {
      // No body provided, use default
      enableEnrichment = true;
    }

    const scraper = new FultonScraper(4, "Fulton", enableEnrichment);
    const liens = await scraper.scrape();

    console.log(
      `Successfully scraped ${liens.length} tax liens from Fulton County`,
    );

    return NextResponse.json({
      success: true,
      message: `Fulton County scraping completed`,
      count: liens.length,
      liens: liens.slice(0, 5), // Return first 5 for preview
    });
  } catch (error) {
    console.error("Fulton scraping error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
