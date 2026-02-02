import * as cheerio from 'cheerio'
import axios from 'axios'
import { BaseScraper, ScrapedTaxLien } from './BaseScraper'

export class DeKalbScraper extends BaseScraper {
  async scrape(): Promise<ScrapedTaxLien[]> {
    try {
      console.log('Starting DeKalb County tax lien scraping...')
      
      // DeKalb uses an HTML form-based search
      const url = 'https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html'
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      const $ = cheerio.load(response.data)
      const liens: ScrapedTaxLien[] = []

      // Look for tax sale listings in table format
      $('table tr').each((index, row) => {
        if (index === 0) return // Skip header row
        
        const $row = $(row)
        const cells = $row.find('td')
        
        if (cells.length >= 4) {
          const parcelId = $(cells[0]).text().trim()
          const ownerName = $(cells[1]).text().trim()
          const propertyAddress = $(cells[2]).text().trim()
          const taxAmountText = $(cells[3]).text().trim()
          
          if (parcelId && ownerName && propertyAddress && taxAmountText) {
            const taxAmount = this.parseCurrency(taxAmountText)
            const { address, city, zip } = this.parseAddress(propertyAddress)
            
            liens.push({
              parcel_id: parcelId,
              owner_name: ownerName,
              property_address: address,
              city,
              zip,
              tax_amount_due: taxAmount
            })
          }
        }
      })

      // If no table found, try alternative selectors
      if (liens.length === 0) {
        $('.tax-sale-item, .property-item, div[class*="tax"]').each((index, element) => {
          const $element = $(element)
          const text = $element.text()
          
          // Try to extract data from text content
          const parcelMatch = text.match(/Parcel[:\s]*([A-Z0-9-]+)/i)
          const ownerMatch = text.match(/Owner[:\s]*([^\n]+)/i)
          const addressMatch = text.match(/Address[:\s]*([^\n]+)/i)
          const amountMatch = text.match(/\$[\d,]+\.?\d*/)
          
          if (parcelMatch && ownerMatch && addressMatch && amountMatch) {
            const { address, city, zip } = this.parseAddress(addressMatch[1].trim())
            
            liens.push({
              parcel_id: parcelMatch[1].trim(),
              owner_name: ownerMatch[1].trim(),
              property_address: address,
              city,
              zip,
              tax_amount_due: this.parseCurrency(amountMatch[0])
            })
          }
        })
      }

      console.log(`Found ${liens.length} tax liens in DeKalb County`)
      
      // Save to database
      await this.saveToDatabase(liens)
      
      return liens
    } catch (error) {
      console.error('Error scraping DeKalb County:', error)
      throw new Error(`DeKalb scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
