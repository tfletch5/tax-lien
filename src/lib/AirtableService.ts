import axios from 'axios'
import { supabaseAdmin } from '@/lib/supabase'
import { TaxLien, Property, InvestmentScore, County } from '@/types'

interface AirtableRecord {
  id?: string
  fields: Record<string, any>
}

export class AirtableService {
  private apiKey: string
  private baseId: string
  private baseUrl = 'https://api.airtable.com/v0'

  constructor() {
    this.apiKey = process.env.AIRTABLE_API_KEY!
    this.baseId = process.env.AIRTABLE_BASE_ID!
    
    if (!this.apiKey || !this.baseId) {
      throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID environment variables are required')
    }
  }

  private async makeRequest(method: string, endpoint: string, data?: any): Promise<any> {
    const url = `${this.baseUrl}/${this.baseId}/${endpoint}`
    
    const config = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(data && { data })
    }

    try {
      const response = await axios(config)
      return response.data
    } catch (error) {
      console.error('Airtable API error:', error)
      throw new Error(`Airtable request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async syncTaxLiens(): Promise<void> {
    try {
      console.log('Starting tax lien sync to Airtable...')

      // Get all tax liens with related data
      const { data: taxLiens } = await supabaseAdmin
        .from('tax_liens')
        .select(`
          *,
          county:counties(name),
          property:properties(*),
          investment_score:investment_scores(*)
        `)
        .order('scraped_at', { ascending: false })

      if (!taxLiens || taxLiens.length === 0) {
        console.log('No tax liens to sync')
        return
      }

      console.log(`Syncing ${taxLiens.length} tax liens to Airtable`)

      // Transform data for Airtable
      const airtableRecords: AirtableRecord[] = taxLiens.map((lien: any) => ({
        fields: {
          'Parcel ID': lien.parcel_id,
          'Owner Name': lien.owner_name,
          'Property Address': lien.property_address,
          'City': lien.city,
          'ZIP': lien.zip,
          'Tax Amount Due': lien.tax_amount_due,
          'Sale Date': lien.sale_date,
          'Legal Description': lien.legal_description,
          'County': lien.county?.name,
          'Scraped At': lien.scraped_at,
          'Estimated Value': lien.property?.estimated_value,
          'Last Sale Price': lien.property?.last_sale_price,
          'Last Sale Date': lien.property?.last_sale_date,
          'Year Built': lien.property?.year_built,
          'Bedrooms': lien.property?.bedrooms,
          'Bathrooms': lien.property?.bathrooms,
          'Square Feet': lien.property?.sqft,
          'Lot Size': lien.property?.lot_size_sqft,
          'Property Type': lien.property?.property_type,
          'Mortgage Balance': lien.property?.mortgage_balance,
          'LTV': lien.investment_score?.ltv,
          'Equity Estimate': lien.investment_score?.equity_estimate,
          'Investment Score': lien.investment_score?.investment_score,
          'Score Breakdown': JSON.stringify(lien.investment_score?.score_breakdown),
          'Last Updated': new Date().toISOString()
        }
      }))

      // Get existing records to avoid duplicates
      const existingRecords = await this.makeRequest('GET', 'Tax Liens?fields[]=Parcel ID')
      const existingParcelIds = new Set(existingRecords.records.map((record: any) => record.fields['Parcel ID']))

      // Filter out records that already exist
      const newRecords = airtableRecords.filter(record => 
        !existingParcelIds.has(record.fields['Parcel ID'])
      )

      if (newRecords.length === 0) {
        console.log('No new tax liens to sync')
        return
      }

      // Upload in batches of 10 (Airtable limit)
      const batchSize = 10
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const batch = newRecords.slice(i, i + batchSize)
        
        await this.makeRequest('POST', 'Tax Liens', { records: batch })
        console.log(`Synced batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(newRecords.length / batchSize)}`)
        
        // Add delay to avoid rate limits
        if (i + batchSize < newRecords.length) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      console.log(`Successfully synced ${newRecords.length} new tax liens to Airtable`)
    } catch (error) {
      console.error('Error syncing tax liens to Airtable:', error)
      throw error
    }
  }

  async syncCounties(): Promise<void> {
    try {
      console.log('Syncing counties to Airtable...')

      const { data: counties } = await supabaseAdmin
        .from('counties')
        .select('*')
        .order('name')

      if (!counties || counties.length === 0) {
        console.log('No counties to sync')
        return
      }

      const airtableRecords: AirtableRecord[] = counties.map((county: County) => ({
        fields: {
          'Name': county.name,
          'State': county.state,
          'Scrape URL': county.scrape_url,
          'Last Scraped': county.last_scraped_at,
          'Last Updated': new Date().toISOString()
        }
      }))

      // Get existing records
      const existingRecords = await this.makeRequest('GET', 'Counties?fields[]=Name')
      const existingNames = new Set(existingRecords.records.map((record: any) => record.fields['Name']))

      // Filter out records that already exist
      const newRecords = airtableRecords.filter(record => 
        !existingNames.has(record.fields['Name'])
      )

      if (newRecords.length > 0) {
        await this.makeRequest('POST', 'Counties', { records: newRecords })
        console.log(`Synced ${newRecords.length} new counties to Airtable`)
      } else {
        console.log('No new counties to sync')
      }
    } catch (error) {
      console.error('Error syncing counties to Airtable:', error)
      throw error
    }
  }

  async syncAllData(): Promise<void> {
    try {
      console.log('Starting full data sync to Airtable...')
      
      await this.syncCounties()
      await this.syncTaxLiens()
      
      console.log('Full data sync to Airtable completed')
    } catch (error) {
      console.error('Error in full data sync:', error)
      throw error
    }
  }

  async createAirtableBase(): Promise<void> {
    try {
      console.log('Creating Airtable base structure...')

      // Note: This would require Airtable Enterprise API or manual setup
      // For now, we'll assume the base exists with the required tables
      
      const tables = [
        {
          name: 'Counties',
          fields: [
            { name: 'Name', type: 'singleLineText' },
            { name: 'State', type: 'singleLineText' },
            { name: 'Scrape URL', type: 'url' },
            { name: 'Last Scraped', type: 'dateTime' },
            { name: 'Last Updated', type: 'dateTime' }
          ]
        },
        {
          name: 'Tax Liens',
          fields: [
            { name: 'Parcel ID', type: 'singleLineText' },
            { name: 'Owner Name', type: 'singleLineText' },
            { name: 'Property Address', type: 'singleLineText' },
            { name: 'City', type: 'singleLineText' },
            { name: 'ZIP', type: 'singleLineText' },
            { name: 'Tax Amount Due', type: 'currency' },
            { name: 'Sale Date', type: 'date' },
            { name: 'Legal Description', type: 'multilineText' },
            { name: 'County', type: 'singleLineText' },
            { name: 'Scraped At', type: 'dateTime' },
            { name: 'Estimated Value', type: 'currency' },
            { name: 'Last Sale Price', type: 'currency' },
            { name: 'Last Sale Date', type: 'date' },
            { name: 'Year Built', type: 'number' },
            { name: 'Bedrooms', type: 'number' },
            { name: 'Bathrooms', type: 'number' },
            { name: 'Square Feet', type: 'number' },
            { name: 'Lot Size', type: 'number' },
            { name: 'Property Type', type: 'singleLineText' },
            { name: 'Mortgage Balance', type: 'currency' },
            { name: 'LTV', type: 'percent' },
            { name: 'Equity Estimate', type: 'currency' },
            { name: 'Investment Score', type: 'number' },
            { name: 'Score Breakdown', type: 'multilineText' },
            { name: 'Last Updated', type: 'dateTime' }
          ]
        }
      ]

      console.log('Airtable base structure defined. Tables should be created manually:', tables)
      console.log('Base ID:', this.baseId)
    } catch (error) {
      console.error('Error creating Airtable base structure:', error)
      throw error
    }
  }
}
