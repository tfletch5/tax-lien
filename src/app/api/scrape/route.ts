import { NextRequest, NextResponse } from 'next/server'
import { ScrapingService } from '@/lib/scraping/ScrapingService'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { county } = body

    const scrapingService = new ScrapingService()
    
    if (county && county !== 'all') {
      await scrapingService.scrapeSpecificCounty(county)
    } else {
      await scrapingService.scrapeAllCounties()
    }

    return NextResponse.json({ 
      success: true, 
      message: county ? `Scraping completed for ${county}` : 'Scraping completed for all counties' 
    })
  } catch (error) {
    console.error('Scraping API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const scrapingService = new ScrapingService()
    const status = await scrapingService.getScrapingStatus()
    
    return NextResponse.json(status)
  } catch (error) {
    console.error('Scraping status API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
