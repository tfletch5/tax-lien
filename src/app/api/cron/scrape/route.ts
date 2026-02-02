import { NextRequest, NextResponse } from 'next/server'
import { ScrapingService } from '@/lib/scraping/ScrapingService'
import { RealEstateService } from '@/lib/RealEstateService'
import { AirtableService } from '@/lib/AirtableService'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a cron job request
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('Starting bi-weekly tax lien scraping job...')
    
    const scrapingService = new ScrapingService()
    const realEstateService = new RealEstateService()
    const airtableService = new AirtableService()

    // Step 1: Scrape all counties for tax lien data
    console.log('Step 1: Scraping tax lien data...')
    await scrapingService.scrapeAllCounties()

    // Step 2: Enrich properties with RealEstateAPI data
    console.log('Step 2: Enriching property data...')
    await realEstateService.enrichAllProperties()

    // Step 3: Sync data to Airtable
    console.log('Step 3: Syncing data to Airtable...')
    await airtableService.syncAllData()

    console.log('Bi-weekly scraping job completed successfully!')

    return NextResponse.json({
      success: true,
      message: 'Bi-weekly tax lien scraping completed successfully',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Cron job error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}
