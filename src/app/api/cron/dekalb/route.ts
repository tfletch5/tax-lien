import { NextRequest, NextResponse } from 'next/server'
import { DeKalbScraper } from '@/lib/scrapers/DeKalbScraper'
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

    console.log('Starting DeKalb County scraping job...')
    
    const scraper = new DeKalbScraper(1, 'DeKalb')
    const realEstateService = new RealEstateService()
    const airtableService = new AirtableService()

    // Step 1: Scrape DeKalb County for tax lien data
    console.log('Step 1: Scraping DeKalb County tax lien data...')
    const liens = await scraper.scrape()

    // Step 2: Enrich DeKalb properties with RealEstateAPI data
    console.log('Step 2: Enriching DeKalb property data...')
    await realEstateService.enrichCountyProperties(1)

    // Step 3: Sync DeKalb data to Airtable
    console.log('Step 3: Syncing DeKalb data to Airtable...')
    await airtableService.syncTaxLiens()

    console.log('DeKalb County scraping job completed successfully!')

    return NextResponse.json({
      success: true,
      message: 'DeKalb County scraping completed successfully',
      liensScraped: liens.length,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('DeKalb cron job error:', error)
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
