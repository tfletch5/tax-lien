import * as cheerio from 'cheerio'
import axios from 'axios'
import { BaseScraper, ScrapedTaxLien } from './BaseScraper'

export class GwinnettScraper extends BaseScraper {
  async scrape(): Promise<ScrapedTaxLien[]> {
    try {
      console.log('Starting Gwinnett County tax lien scraping...')
      
      // Gwinnett has both HTML content and PDF results
      const url = 'https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales'
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      const $ = cheerio.load(response.data)
      const liens: ScrapedTaxLien[] = []

      // Look for tax sale results link
      const pdfLinks = $('a[href*="tax-sale-results"], a[href*="results"]').map((i, el) => $(el).attr('href')).get()
      
      if (pdfLinks.length > 0) {
        console.log('Found tax sale results PDF, attempting to parse...')
        // For now, we'll focus on HTML content
      }

      // Look for delinquent tax lists or tax sale information
      $('table tr, .tax-sale-item, .delinquent-item').each((index, element) => {
        const $element = $(element)
        const $cells = $element.find('td, th')
        
        if ($cells.length >= 3) {
          const parcelId = $cells.eq(0).text().trim()
          const ownerName = $cells.eq(1).text().trim()
          const addressInfo = $cells.eq(2).text().trim()
          const taxAmountText = $cells.length > 3 ? $cells.eq(3).text().trim() : ''
          
          if (parcelId && ownerName && addressInfo) {
            const { address, city, zip } = this.parseAddress(addressInfo)
            const taxAmount = taxAmountText ? this.parseCurrency(taxAmountText) : 0
            
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

      // Alternative: Look for structured data in divs
      if (liens.length === 0) {
        const contentText = $('body').text()
        
        // Try to find patterns in the text
        const propertyPattern = /(?:Parcel|PID)[\s:]*([A-Z0-9-]+)[\s\S]*?(?:Owner|Name)[\s:]*([^\n]+)[\s\S]*?(?:Address|Location)[\s:]*([^\n]+)[\s\S]*?\$[\d,]+\.?\d*/gi
        
        let match
        while ((match = propertyPattern.exec(contentText)) !== null) {
          const { address, city, zip } = this.parseAddress(match[3].trim())
          const amountMatch = match[0].match(/\$[\d,]+\.?\d*/)
          
          liens.push({
            parcel_id: match[1].trim(),
            owner_name: match[2].trim(),
            property_address: address,
            city,
            zip,
            tax_amount_due: amountMatch ? this.parseCurrency(amountMatch[0]) : 0
          })
        }
      }

      console.log(`Found ${liens.length} tax liens in Gwinnett County`)
      
      // Save to database
      await this.saveToDatabase(liens)
      
      return liens
    } catch (error) {
      console.error('Error scraping Gwinnett County:', error)
      throw new Error(`Gwinnett scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
