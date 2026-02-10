import { NextRequest, NextResponse } from "next/server";
import { FultonScraper } from "@/lib/scrapers/FultonScraper";

export async function POST(request: NextRequest) {
  try {
    const { data } = await request.json();

    if (!data || typeof data !== "string") {
      return NextResponse.json(
        { error: "Manual input data is required" },
        { status: 400 },
      );
    }

    // Set environment variable for manual input
    process.env.FULTON_MANUAL_INPUT = data;

    // Create scraper with manual input (Fulton county ID is 4)
    const scraper = new FultonScraper(4, "Fulton", true); // Enable enrichment

    console.log("Starting Fulton County manual input processing...");

    const liens = await scraper.scrape();

    // Clear the environment variable after processing
    delete process.env.FULTON_MANUAL_INPUT;

    return NextResponse.json({
      success: true,
      message: "Fulton County manual input processing completed",
      count: liens.length,
      liens: liens,
    });
  } catch (error) {
    console.error("Error processing Fulton manual input:", error);
    return NextResponse.json(
      {
        error: "Failed to process manual input",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
