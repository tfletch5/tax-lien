import { NextRequest, NextResponse } from 'next/server'
import { AirtableService } from '@/lib/AirtableService'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    const airtableService = new AirtableService()
    
    switch (action) {
      case 'syncTaxLiens':
        await airtableService.syncTaxLiens()
        return NextResponse.json({ 
          success: true, 
          message: 'Tax liens synced to Airtable successfully' 
        })
        
      case 'syncCounties':
        await airtableService.syncCounties()
        return NextResponse.json({ 
          success: true, 
          message: 'Counties synced to Airtable successfully' 
        })
        
      case 'syncAll':
        await airtableService.syncAllData()
        return NextResponse.json({ 
          success: true, 
          message: 'All data synced to Airtable successfully' 
        })
        
      case 'createBase':
        await airtableService.createAirtableBase()
        return NextResponse.json({ 
          success: true, 
          message: 'Airtable base structure created' 
        })
        
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action. Use syncTaxLiens, syncCounties, syncAll, or createBase' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Airtable API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
