import axios from 'axios'
import { supabaseAdmin } from '@/lib/supabase'
import { calculateLTV, calculateEquity, calculateInvestmentScore } from '@/lib/utils'

interface RealEstateAPIResponse {
  address: string
  estimatedValue: number
  lastSalePrice?: number
  lastSaleDate?: string
  yearBuilt?: number
  bedrooms?: number
  bathrooms?: number
  sqft?: number
  lotSizeSqft?: number
  propertyType?: string
  mortgageBalance?: number
}

export class RealEstateService {
  private apiKey: string
  private baseUrl = 'https://api.realestateapi.com/v2'

  constructor() {
    this.apiKey = process.env.REALESTATE_API_KEY!
    if (!this.apiKey) {
      throw new Error('REALESTATE_API_KEY environment variable is required')
    }
  }

  async enrichProperty(taxLienId: string, address: string, city?: string, zip?: string): Promise<void> {
    try {
      console.log(`Enriching property: ${address}`)
      
      const fullAddress = [address, city, zip].filter(Boolean).join(', ')
      
      const response = await axios.get(`${this.baseUrl}/property`, {
        params: {
          address: fullAddress,
          apiKey: this.apiKey
        },
        headers: {
          'Accept': 'application/json'
        }
      })

      const propertyData: RealEstateAPIResponse = response.data

      // Save property details to database
      await supabaseAdmin
        .from('properties')
        .upsert({
          tax_lien_id: taxLienId,
          estimated_value: propertyData.estimatedValue,
          last_sale_price: propertyData.lastSalePrice,
          last_sale_date: propertyData.lastSaleDate,
          year_built: propertyData.yearBuilt,
          bedrooms: propertyData.bedrooms,
          bathrooms: propertyData.bathrooms,
          sqft: propertyData.sqft,
          lot_size_sqft: propertyData.lotSizeSqft,
          property_type: propertyData.propertyType,
          mortgage_balance: propertyData.mortgageBalance,
          enriched_at: new Date().toISOString()
        }, {
          onConflict: 'tax_lien_id'
        })

      // Get tax lien data for investment calculations
      const { data: taxLien } = await supabaseAdmin
        .from('tax_liens')
        .select('tax_amount_due, county_id')
        .eq('id', taxLienId)
        .single()

      if (taxLien && propertyData.estimatedValue > 0) {
        // Calculate investment metrics
        const mortgageBalance = propertyData.mortgageBalance || 0
        const ltv = calculateLTV(mortgageBalance, taxLien.tax_amount_due, propertyData.estimatedValue)
        const equity = calculateEquity(propertyData.estimatedValue, mortgageBalance, taxLien.tax_amount_due)
        
        // Get county name for scoring
        const { data: county } = await supabaseAdmin
          .from('counties')
          .select('name')
          .eq('id', taxLien.county_id)
          .single()

        const investmentScore = calculateInvestmentScore(
          ltv,
          equity,
          taxLien.tax_amount_due,
          propertyData.estimatedValue,
          propertyData.propertyType || 'Unknown',
          county?.name || 'Unknown'
        )

        // Save investment score
        await supabaseAdmin
          .from('investment_scores')
          .upsert({
            tax_lien_id: taxLienId,
            ltv,
            equity_estimate: equity,
            investment_score: investmentScore.score,
            score_breakdown: investmentScore.breakdown,
            calculated_at: new Date().toISOString()
          }, {
            onConflict: 'tax_lien_id'
          })

        console.log(`Property enriched and scored: ${address} (Score: ${investmentScore.score})`)
      }
    } catch (error) {
      console.error(`Error enriching property ${address}:`, error)
      
      // Log the error but don't throw - we don't want to stop the entire process
      await supabaseAdmin
        .from('properties')
        .upsert({
          tax_lien_id: taxLienId,
          enriched_at: new Date().toISOString()
        }, {
          onConflict: 'tax_lien_id'
        })
    }
  }

  async enrichAllProperties(): Promise<void> {
    try {
      console.log('Starting property enrichment for all tax liens...')

      // Get all tax liens that don't have property data yet
      const { data: taxLiens } = await supabaseAdmin
        .from('tax_liens')
        .select(`
          id,
          property_address,
          city,
          zip,
          properties(id)
        `)
        .is('properties.id', null)
        .limit(100) // Process in batches

      if (!taxLiens || taxLiens.length === 0) {
        console.log('No properties to enrich')
        return
      }

      console.log(`Found ${taxLiens.length} properties to enrich`)

      // Process properties in parallel with a delay to avoid rate limits
      const batchSize = 5
      for (let i = 0; i < taxLiens.length; i += batchSize) {
        const batch = taxLiens.slice(i, i + batchSize)
        
        await Promise.all(
          batch.map(lien => 
            this.enrichProperty(
              lien.id, 
              lien.property_address, 
              lien.city || undefined, 
              lien.zip || undefined
            )
          )
        )

        // Add delay between batches to respect API limits
        if (i + batchSize < taxLiens.length) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      console.log('Property enrichment completed')
    } catch (error) {
      console.error('Error in property enrichment:', error)
      throw error
    }
  }

  async enrichCountyProperties(countyId: number): Promise<void> {
    try {
      console.log(`Starting property enrichment for county ${countyId}...`)

      const { data: taxLiens } = await supabaseAdmin
        .from('tax_liens')
        .select(`
          id,
          property_address,
          city,
          zip,
          properties(id)
        `)
        .eq('county_id', countyId)
        .is('properties.id', null)
        .limit(50)

      if (!taxLiens || taxLiens.length === 0) {
        console.log('No properties to enrich for this county')
        return
      }

      console.log(`Found ${taxLiens.length} properties to enrich for county ${countyId}`)

      await Promise.all(
        taxLiens.map(lien => 
          this.enrichProperty(
            lien.id, 
            lien.property_address, 
            lien.city || undefined, 
            lien.zip || undefined
          )
        )
      )

      console.log(`Property enrichment completed for county ${countyId}`)
    } catch (error) {
      console.error(`Error enriching county ${countyId} properties:`, error)
      throw error
    }
  }
}
