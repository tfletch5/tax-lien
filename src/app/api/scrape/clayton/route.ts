import { NextRequest, NextResponse } from "next/server";
import { ClaytonScraper } from "@/lib/scrapers/ClaytonScraper";

export async function POST(request: NextRequest) {
  try {
    console.log("Starting Clayton County tax lien scraping...");

    // Check if enrichment should be enabled (default: true)
    let enableEnrichment = true;
    try {
      const body = await request.json();
      enableEnrichment = body.enableEnrichment !== false; // Default to true
    } catch {
      // No body provided, use default
      enableEnrichment = true;
    }

    const scraper = new ClaytonScraper(5, "Clayton", enableEnrichment);
    const liens = await scraper.scrape();

    console.log(
      `Successfully scraped ${liens.length} tax liens from Clayton County`,
    );

    return NextResponse.json({
      success: true,
      message: `Clayton County scraping completed`,
      count: liens.length,
      liens: liens.slice(0, 5), // Return first 5 for preview
    });
  } catch (error) {
    console.error("Clayton scraping error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
