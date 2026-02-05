import { DeKalbScraper } from "../scrapers/DeKalbScraper";
import { GwinnettScraper } from "../scrapers/GwinnettScraper";
import { CobbScraper } from "../scrapers/CobbScraper";
import { FultonScraper } from "../scrapers/FultonScraper";
import { ClaytonScraper } from "../scrapers/ClaytonScraper";
import { supabaseAdmin } from "@/lib/supabase";

export class ScrapingService {
  private scrapers = [
    new DeKalbScraper(1, "DeKalb", true), // Enable enrichment for DeKalb
    new GwinnettScraper(2, "Gwinnett", true), // Enable enrichment for Gwinnett
    new CobbScraper(3, "Cobb", true), // Enable enrichment for Cobb
    new FultonScraper(4, "Fulton", true), // Enable enrichment for Fulton
    new ClaytonScraper(5, "Clayton", true), // Enable enrichment for Clayton
  ];

  async scrapeAllCounties(): Promise<void> {
    console.log("Starting tax lien scraping for all counties...");

    const results = [];

    for (const scraper of this.scrapers) {
      try {
        console.log(`Scraping ${scraper["countyName"]}...`);
        const liens = await scraper.scrape();
        results.push({
          county: scraper["countyName"],
          success: true,
          count: liens.length,
        });
      } catch (error) {
        console.error(`Failed to scrape ${scraper["countyName"]}:`, error);
        results.push({
          county: scraper["countyName"],
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log("Scraping completed. Results:", results);

    // Update county last_scraped timestamps
    for (const scraper of this.scrapers) {
      try {
        await supabaseAdmin
          .from("counties")
          .update({ last_scraped_at: new Date().toISOString() })
          .eq("id", scraper["countyId"]);
      } catch (error) {
        console.warn(
          `Failed to update timestamp for ${scraper["countyName"]}:`,
          error,
        );
      }
    }
  }

  async scrapeSpecificCounty(countyName: string): Promise<void> {
    const scraper = this.scrapers.find(
      (s) => s["countyName"].toLowerCase() === countyName.toLowerCase(),
    );

    if (!scraper) {
      throw new Error(`County ${countyName} not found`);
    }

    console.log(`Scraping ${countyName}...`);
    const liens = await scraper.scrape();
    console.log(
      `Successfully scraped ${liens.length} tax liens from ${countyName}`,
    );
  }

  async getScrapingStatus(): Promise<any> {
    const { data: counties } = await supabaseAdmin
      .from("counties")
      .select("id, name, last_scraped_at")
      .order("name");

    const { data: recentLogs } = await supabaseAdmin
      .from("scrape_logs")
      .select(
        `
        *,
        county:counties(name)
      `,
      )
      .order("started_at", { ascending: false })
      .limit(10);

    return {
      counties: counties || [],
      recentLogs: recentLogs || [],
    };
  }
}
