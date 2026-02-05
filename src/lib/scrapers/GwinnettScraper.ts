import * as cheerio from 'cheerio'
import axios from 'axios'
import { BaseScraper, ScrapedTaxLien } from './BaseScraper'
import { RealEstateService } from '@/lib/RealEstateService'
import { parsePdf } from '@/lib/utils/pdfParse'

export class GwinnettScraper extends BaseScraper {
  private enableEnrichment: boolean
  private realEstateService: RealEstateService | null = null

  constructor(countyId: number, countyName: string, enableEnrichment: boolean = true) {
    super(countyId, countyName)
    this.enableEnrichment = enableEnrichment
    if (enableEnrichment) {
      try {
        this.realEstateService = new RealEstateService()
      } catch (error) {
        console.warn('RealEstateService initialization failed, enrichment disabled:', error)
        this.enableEnrichment = false
      }
    }
  }

  async scrape(): Promise<ScrapedTaxLien[]> {
    try {
      console.log('Starting Gwinnett County tax lien scraping...')
      if (this.enableEnrichment) {
        console.log('⚠️ Enrichment during scraping is ENABLED - only properties with assessedImprovementValue > 0 will be saved')
      }
      
      // Gwinnett uses PDF files for tax sale listings
      const url = 'https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales'
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      const $ = cheerio.load(response.data)
      const liens: ScrapedTaxLien[] = []

      // Find "Upcoming Tax Sales" section and look for PDF links
      // Look for links that contain "List of Properties" or similar text
      // Also look for document download links (Google Docs viewer links)
      const allLinks = $('a').map((i, el) => {
        const href = $(el).attr('href')
        const text = $(el).text().trim()
        const parentText = $(el).parent().text().trim()
        const grandParentText = $(el).parent().parent().text().trim()
        return { href, text, parentText, grandParentText }
      }).get()

      console.log(`Found ${allLinks.length} total links on the page`)
      
      // Debug: Log links that might be relevant
      const potentialLinks = allLinks.filter(link => {
        if (!link.href) return false
        const combinedText = `${link.text} ${link.parentText}`.toLowerCase()
        return combinedText.includes('list of properties') || 
               combinedText.includes('tax sale') ||
               link.href.includes('/documents/') ||
               link.href.includes('.pdf')
      })
      console.log(`Found ${potentialLinks.length} potentially relevant links`)
      potentialLinks.slice(0, 5).forEach((link, i) => {
        console.log(`  Link ${i + 1}: text="${link.text}", href="${link.href}", parent="${link.parentText.substring(0, 50)}"`)
      })

      // Filter for "Upcoming Tax Sales" PDFs - look for "List of Properties" links
      // The links might be:
      // 1. Direct PDF links (href contains .pdf)
      // 2. Google Docs viewer links (href contains /documents/)
      // 3. Links with "List of Properties" text (most important!)
      let upcomingTaxSalePdfs = allLinks.filter(link => {
        if (!link.href) return false
        
        const combinedText = `${link.text} ${link.parentText} ${link.grandParentText}`.toLowerCase()
        const hrefLower = link.href.toLowerCase()
        const linkTextLower = link.text.toLowerCase()
        
        // First priority: Links with "List of Properties" text - these are definitely what we want
        // Check both exact text and combined text (in case text is split)
        const hasListOfProperties = linkTextLower.includes('list of properties') ||
                                    linkTextLower.includes('listofproperties') ||
                                    (linkTextLower.includes('list') && linkTextLower.includes('properties'))
        
        if (hasListOfProperties) {
          console.log(`✅ Found "List of Properties" link: text="${link.text}", href="${link.href}"`)
          return true
        }
        
        // Second priority: Links in context that mentions tax sale and is a document/PDF link
        const isPdfOrDocumentLink = hrefLower.includes('.pdf') || 
                                    hrefLower.includes('/documents/') ||
                                    hrefLower.includes('download=true')
        
        const isTaxSaleContext = combinedText.includes('upcoming tax sale') ||
                                combinedText.includes('tax sale web list') ||
                                combinedText.includes('tax sale')
        
        return isPdfOrDocumentLink && isTaxSaleContext
      })

      console.log(`Found ${upcomingTaxSalePdfs.length} Upcoming Tax Sales PDF links`)
      
      // Filter out non-tax-sale PDFs (like bidder registration forms)
      const taxSaleListPdfs = upcomingTaxSalePdfs.filter(link => {
        const combinedText = `${link.text} ${link.parentText}`.toLowerCase()
        // Exclude registration forms, bidder packets, etc.
        const isExcluded = combinedText.includes('bidder') ||
                          combinedText.includes('registration') ||
                          combinedText.includes('packet') ||
                          combinedText.includes('form')
        
        if (isExcluded) {
          console.log(`⚠️ Excluding non-tax-sale PDF: "${link.text}"`)
        }
        
        return !isExcluded
      })
      
      // If we filtered some out, use the filtered list
      if (taxSaleListPdfs.length < upcomingTaxSalePdfs.length) {
        console.log(`Filtered to ${taxSaleListPdfs.length} tax sale list PDFs (excluded ${upcomingTaxSalePdfs.length - taxSaleListPdfs.length} non-tax-sale PDFs)`)
        upcomingTaxSalePdfs = taxSaleListPdfs
      }

      // If no matches found, try a broader search
      if (upcomingTaxSalePdfs.length === 0) {
        console.warn('No Upcoming Tax Sales PDFs found with strict filter. Trying broader search...')
        
        // Look for any link with "List of Properties" text (case insensitive, partial match)
        const listOfPropertiesLinks = allLinks.filter(link => {
          if (!link.href) return false
          const linkTextLower = link.text.toLowerCase().trim()
          const combinedText = `${link.text} ${link.parentText}`.toLowerCase()
          
          // Very flexible matching
          const matches = linkTextLower.includes('list of properties') ||
                         linkTextLower.includes('listofproperties') ||
                         (linkTextLower.includes('list') && linkTextLower.includes('properties')) ||
                         combinedText.includes('list of properties')
          
          if (matches) {
            console.log(`  Found in fallback: text="${link.text}", href="${link.href}"`)
          }
          
          return matches
        })
        
        if (listOfPropertiesLinks.length > 0) {
          console.log(`Found ${listOfPropertiesLinks.length} "List of Properties" links (broad search)`)
          listOfPropertiesLinks.forEach(link => {
            console.log(`  - "${link.text}" -> ${link.href}`)
          })
          upcomingTaxSalePdfs.push(...listOfPropertiesLinks)
        } else {
          // Last resort: try all document links
          const documentLinks = allLinks.filter(link => 
            link.href && (link.href.includes('.pdf') || link.href.includes('/documents/'))
          )
          console.log(`Falling back to all PDF/document links: ${documentLinks.length} found`)
          documentLinks.slice(0, 10).forEach(link => {
            console.log(`  - "${link.text}" -> ${link.href}`)
          })
          upcomingTaxSalePdfs.push(...documentLinks)
        }
      }

      // Process each PDF
      for (const pdfLink of upcomingTaxSalePdfs) {
        try {
          if (!pdfLink.href) continue

          // Construct full URL
          let pdfUrl = pdfLink.href.startsWith('http')
            ? pdfLink.href
            : pdfLink.href.startsWith('/')
            ? `https://www.gwinnetttaxcommissioner.com${pdfLink.href}`
            : `https://www.gwinnetttaxcommissioner.com/${pdfLink.href}`
          
          // For Google Docs viewer links, ensure download=true is present
          if (pdfUrl.includes('/documents/') && !pdfUrl.includes('download=true')) {
            pdfUrl += (pdfUrl.includes('?') ? '&' : '?') + 'download=true'
          }

          console.log(`Processing PDF: ${pdfLink.text || pdfLink.href}`)
          console.log(`PDF URL: ${pdfUrl}`)

          const pdfLiens = await this.parsePdf(pdfUrl)
          liens.push(...pdfLiens)
          console.log(`Extracted ${pdfLiens.length} liens from PDF: ${pdfLink.text || pdfLink.href}`)
        } catch (pdfError) {
          console.error(`Failed to process PDF ${pdfLink.text || pdfLink.href}:`, pdfError)
        }
      }

      console.log(`Found ${liens.length} total tax liens in Gwinnett County`)
      
      // Enrich and filter liens if enrichment is enabled
      let validLiens: ScrapedTaxLien[] = []
      if (this.enableEnrichment && this.realEstateService) {
        console.log(`Enriching ${liens.length} liens to validate assessedImprovementValue...`)
        validLiens = await this.enrichAndFilterLiens(liens)
        console.log(`After enrichment filtering: ${validLiens.length} valid liens (${liens.length - validLiens.length} skipped)`)
      } else {
        validLiens = liens
      }
      
      // Save to database
      await this.saveToDatabase(validLiens)
      
      // After saving, enrich the saved liens to populate properties and investment scores
      if (this.enableEnrichment && this.realEstateService && validLiens.length > 0) {
        console.log(`Enriching ${validLiens.length} saved liens to populate properties and investment scores...`)
        await this.enrichSavedLiens(validLiens)
      }
      
      return validLiens
    } catch (error) {
      console.error('Error scraping Gwinnett County:', error)
      throw new Error(`Gwinnett scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Enrich each lien and filter out those with assessedImprovementValue = 0
   * Includes rate limiting to avoid API throttling
   */
  private async enrichAndFilterLiens(liens: ScrapedTaxLien[]): Promise<ScrapedTaxLien[]> {
    if (!this.realEstateService) {
      return liens
    }

    const validLiens: ScrapedTaxLien[] = []
    const rateLimitDelay = 200 // 200ms delay between API calls (5 requests per second max)

    for (let i = 0; i < liens.length; i++) {
      const lien = liens[i]
      
      try {
        // Rate limiting: wait between requests
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay))
        }

        // Build address string for fallback search
        const address = lien.property_address
          ? `${lien.property_address}${lien.city ? `, ${lien.city}` : ''}${lien.zip ? ` ${lien.zip}` : ''}`
          : undefined

        console.log(`[${i + 1}/${liens.length}] Validating lien ${lien.parcel_id}...`)

        // Enrich property (validation only - doesn't save to DB)
        const enrichmentResult = await this.realEstateService.enrichPropertyByParcel(
          lien.parcel_id,
          address
        )

        if (enrichmentResult && enrichmentResult.isValid) {
          validLiens.push(lien)
          console.log(`✅ Lien ${lien.parcel_id} is valid and will be saved`)
        } else {
          console.log(`⚠️ Lien ${lien.parcel_id} skipped (assessedImprovementValue = 0 or enrichment failed)`)
        }
      } catch (error) {
        console.error(`Error validating lien ${lien.parcel_id}:`, error)
        // On error, decide whether to save or skip
        // For now, we'll skip on error to be conservative
        console.log(`⚠️ Lien ${lien.parcel_id} skipped due to validation error`)
      }
    }

    return validLiens
  }

  /**
   * Enrich saved liens to populate properties and investment scores
   * This is called after liens are saved to the database
   */
  private async enrichSavedLiens(liens: ScrapedTaxLien[]): Promise<void> {
    if (!this.realEstateService) {
      return
    }

    const { supabaseAdmin } = await import('@/lib/supabase')
    const rateLimitDelay = 200 // 200ms delay between API calls

    for (let i = 0; i < liens.length; i++) {
      const lien = liens[i]
      
      try {
        // Rate limiting: wait between requests
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay))
        }

        // Get the saved tax lien ID from the database
        const { data: savedLien, error: fetchError } = await supabaseAdmin
          .from('tax_liens')
          .select('id')
          .eq('county_id', this.countyId)
          .eq('parcel_id', lien.parcel_id)
          .single()

        if (fetchError || !savedLien) {
          console.error(`Error fetching saved lien ${lien.parcel_id}:`, fetchError)
          continue
        }

        console.log(`[${i + 1}/${liens.length}] Enriching saved lien ${lien.parcel_id} (ID: ${savedLien.id})...`)

        // Enrich property - this will save to properties table and calculate investment scores
        await this.realEstateService.enrichProperty(
          savedLien.id,
          lien.parcel_id
        )

        console.log(`✅ Successfully enriched lien ${lien.parcel_id}`)
      } catch (error) {
        console.error(`Error enriching saved lien ${lien.parcel_id}:`, error)
        // Continue with next lien even if this one fails
      }
    }

    console.log(`✅ Completed enrichment for ${liens.length} saved liens`)
  }

  private async parsePdf(pdfUrl: string): Promise<ScrapedTaxLien[]> {
    try {
      // Download PDF - handle Google Docs viewer links that initiate downloads
      // These links need special handling to get the actual PDF binary
      let pdfBuffer: Buffer
      
      if (pdfUrl.includes('/documents/')) {
        // For Google Docs viewer links, we need to ensure we get the PDF
        // The download=true parameter should trigger a download, but we may need to follow redirects
        console.log(`Downloading PDF from Google Docs viewer link: ${pdfUrl}`)
        
        // Try to get the PDF directly - Google Docs viewer links with download=true should redirect to the PDF
        try {
          const pdfResponse = await axios.get(pdfUrl, {
            responseType: 'arraybuffer',
            maxRedirects: 10, // Follow redirects (Google Docs may redirect multiple times)
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/pdf,application/octet-stream,*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.gwinnetttaxcommissioner.com/'
            },
            validateStatus: (status) => status >= 200 && status < 400 // Accept redirects
          })
          
          // Check if we got HTML instead of PDF (Google Docs might return HTML viewer)
          const contentType = pdfResponse.headers['content-type'] || ''
          const data = pdfResponse.data
          const dataStart = data instanceof Buffer ? data.toString('utf8', 0, 100) : ''
          
          if (contentType.includes('text/html') || dataStart.includes('<!DOCTYPE') || dataStart.includes('<html')) {
            console.warn('Received HTML instead of PDF, trying to extract download URL...')
            
            // If we got HTML, try to find the actual PDF download URL in the response
            const htmlContent = data instanceof Buffer ? data.toString('utf8') : String(data)
            
            // Look for various patterns that might contain the PDF URL
            const patterns = [
              /https?:\/\/[^"'\s<>]+export=download[^"'\s<>]*/i,
              /https?:\/\/[^"'\s<>]+\.pdf[^"'\s<>]*/i,
              /href=["']([^"']*export=download[^"']*)["']/i,
              /url\(["']?([^"')]+export=download[^"')]+)["']?\)/i
            ]
            
            let actualPdfUrl: string | null = null
            for (const pattern of patterns) {
              const match = htmlContent.match(pattern)
              if (match) {
                actualPdfUrl = match[1] || match[0]
                break
              }
            }
            
            if (actualPdfUrl) {
              console.log(`Found actual PDF URL in HTML: ${actualPdfUrl}`)
              
              const actualPdfResponse = await axios.get(actualPdfUrl, {
                responseType: 'arraybuffer',
                maxRedirects: 10,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              })
              pdfBuffer = Buffer.from(actualPdfResponse.data)
            } else {
              // If we can't find the URL, try modifying the original URL
              // Google Docs viewer URLs can sometimes be converted to direct download URLs
              const modifiedUrl = pdfUrl.replace('/view', '').replace('/edit', '') + '&export=download'
              console.log(`Trying modified URL: ${modifiedUrl}`)
              
              const modifiedResponse = await axios.get(modifiedUrl, {
                responseType: 'arraybuffer',
                maxRedirects: 10,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              })
              pdfBuffer = Buffer.from(modifiedResponse.data)
            }
          } else {
            // We got PDF content directly
            pdfBuffer = Buffer.from(data)
            console.log(`✅ Successfully downloaded PDF (${pdfBuffer.length} bytes)`)
          }
        } catch (error: any) {
          console.error(`Error downloading from Google Docs link: ${error.message}`)
          throw error
        }
      } else {
        // Regular PDF link
        const pdfResponse = await axios.get(pdfUrl, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })
        pdfBuffer = Buffer.from(pdfResponse.data)
        console.log(`✅ Successfully downloaded PDF (${pdfBuffer.length} bytes)`)
      }
      
      // Validate that we have a PDF buffer
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('Downloaded PDF buffer is empty')
      }
      
      // Check if it's actually a PDF by looking at the PDF header
      const pdfHeader = pdfBuffer.toString('ascii', 0, 4)
      if (pdfHeader !== '%PDF') {
        console.warn(`Warning: Buffer does not start with PDF header. Got: ${pdfHeader}`)
        // Still try to parse it, might be a valid PDF with different encoding
      }
      
      // Parse PDF using wrapper utility to handle module format issues
      const pdfData = await parsePdf(pdfBuffer)
      const text = pdfData.text

      console.log(`PDF parsed, text length: ${text.length} characters`)
      
      // Extract sale date from header (e.g., "Tuesday, March 3, 2026")
      const dateMatch = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(\w+)\s+(\d+),\s+(\d{4})/i)
      let saleDate: string | undefined
      if (dateMatch) {
        const month = dateMatch[1]
        const day = dateMatch[2]
        const year = dateMatch[3]
        saleDate = `${month} ${day}, ${year}`
      }

      const liens: ScrapedTaxLien[] = []
      
      // Split text into lines
      const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
      
      // Find the table header row (PIN | OwnerName | Situs | Amount Due)
      let headerIndex = -1
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase()
        if (line.includes('pin') && (line.includes('owner') || line.includes('ownername')) && line.includes('situs') && line.includes('amount')) {
          headerIndex = i
          break
        }
      }

      if (headerIndex === -1) {
        console.warn('Could not find table header in PDF. Attempting to parse without header...')
        // Try to find rows that match the pattern
        for (let i = 0; i < lines.length; i++) {
          const lien = this.parseTableRow(lines[i], saleDate)
          if (lien) {
            liens.push(lien)
          }
        }
        return liens
      }

      console.log(`Found table header at line ${headerIndex}`)

      // Parse rows after the header
      // The table format is: PIN | OwnerName | Situs | Amount Due
      // Try to parse line by line, looking for rows that match the pattern
      for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i]
        
        // Skip separator lines (lines that are just dashes or pipes)
        if (line.match(/^[\s|-\|]+$/)) {
          continue
        }
        
        // Check if this line looks like a table row (starts with PIN pattern like "R####")
        const pinMatch = line.match(/^R\d+\s+\d+[A-Z]?/)
        
        if (pinMatch) {
          // Try to parse this line as a complete row
          const lien = this.parseTableRow(line, saleDate)
          if (lien) {
            liens.push(lien)
          } else {
            // If parsing failed, try combining with next line(s)
            let combinedLine = line
            let j = i + 1
            while (j < lines.length && j < i + 3) { // Try up to 3 lines
              const nextLine = lines[j]
              // Check if next line has an amount (indicates end of row)
              if (nextLine.match(/[\d,]+\.\d{2}\s*$/)) {
                combinedLine += ' ' + nextLine
                const combinedLien = this.parseTableRow(combinedLine, saleDate)
                if (combinedLien) {
                  liens.push(combinedLien)
                  i = j // Skip the lines we just processed
                  break
                }
              } else {
                combinedLine += ' ' + nextLine
              }
              j++
            }
          }
        }
      }

      // Alternative parsing: Try regex-based parsing if the above didn't work well
      if (liens.length === 0) {
        console.log('Attempting regex-based parsing...')
        const rowPattern = /(R\d+\s+\d+[A-Z]?)\s+\|?\s*([^|]+?)\s+\|?\s*([^|]+?)\s+\|?\s*([\d,]+\.\d+)/g
        let match
        while ((match = rowPattern.exec(text)) !== null) {
          const pin = match[1].trim()
          const ownerName = match[2].trim()
          const situs = match[3].trim()
          const amountText = match[4].trim()

          if (pin && ownerName && situs && amountText) {
            const taxAmount = this.parseCurrency(amountText)
            // Clean the situs field to remove any owner name
            const cleanedSitus = this.cleanAddressFromName(situs, ownerName)
            const { address, city, zip } = this.parseAddress(cleanedSitus)

            liens.push({
              parcel_id: pin,
              owner_name: ownerName,
              property_address: address,
              city: city || 'LAWRENCEVILLE', // Default city for Gwinnett County
              zip: zip || '',
              tax_amount_due: taxAmount,
              sale_date: saleDate
            })
          }
        }
      }

      console.log(`Parsed ${liens.length} liens from PDF`)
      return liens
    } catch (error) {
      console.error(`Error parsing PDF ${pdfUrl}:`, error)
      throw error
    }
  }

  /**
   * Remove owner name from address field if it appears at the beginning
   * Addresses sometimes have names like "Thai H 596 CHESTERFIELD DR" - we want just "596 CHESTERFIELD DR"
   */
  private cleanAddressFromName(address: string, ownerName: string): string {
    let cleaned = address.trim()
    
    // Remove owner name if it appears at the start of the address
    // Try different variations of the owner name
    const ownerNameVariations = [
      ownerName,
      ownerName.split(' ')[0], // First name only
      ownerName.split(' ').slice(0, 2).join(' '), // First two words
    ]
    
    for (const nameVariant of ownerNameVariations) {
      if (nameVariant && nameVariant.length > 1) {
        // Remove name if it appears at the start, followed by a space and a number (street number)
        const namePattern = new RegExp(`^${this.escapeRegex(nameVariant)}\\s+(\\d+)`, 'i')
        if (namePattern.test(cleaned)) {
          cleaned = cleaned.replace(namePattern, '$1').trim()
          break
        }
        
        // Also try removing just the name if it's at the start
        const simpleNamePattern = new RegExp(`^${this.escapeRegex(nameVariant)}\\s+`, 'i')
        if (simpleNamePattern.test(cleaned)) {
          cleaned = cleaned.replace(simpleNamePattern, '').trim()
          // Check if what's left starts with a number (valid address)
          if (/^\d+/.test(cleaned)) {
            break
          } else {
            // Restore if removal didn't leave a valid address
            cleaned = address.trim()
          }
        }
      }
    }
    
    // Additional cleanup: Remove common name patterns at the start
    // Pattern: Name (1-3 words) followed by a number (street address)
    const nameAtStartPattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(\d+\s+[A-Z])/i
    const nameMatch = cleaned.match(nameAtStartPattern)
    if (nameMatch && nameMatch[2]) {
      // If we found a pattern like "Name 123 STREET", extract just "123 STREET"
      cleaned = cleaned.substring(nameMatch[0].indexOf(nameMatch[2])).trim()
    }
    
    return cleaned
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private parseTableRow(rowText: string, saleDate?: string): ScrapedTaxLien | null {
    try {
      // Try to split by pipe separator first
      let parts: string[] = []
      
      if (rowText.includes('|')) {
        parts = rowText.split('|').map(p => p.trim())
      } else {
        // Try to parse without pipes - look for pattern: PIN OwnerName Situs Amount
        // PIN format: R#### ### or R#### ###A
        const pinMatch = rowText.match(/^(R\d+\s+\d+[A-Z]?)/)
        if (!pinMatch) {
          return null
        }

        const pin = pinMatch[1].trim()
        const afterPin = rowText.substring(pinMatch[0].length).trim()
        
        // Find the amount at the end (format: number with comma and 2 decimals)
        const amountMatch = afterPin.match(/([\d,]+\.\d{2})\s*$/)
        if (!amountMatch) {
          return null
        }

        const amountText = amountMatch[1]
        const beforeAmount = afterPin.substring(0, afterPin.lastIndexOf(amountText)).trim()
        
        // Try to split owner name and address
        // Owner name is usually shorter, address is usually longer
        // Look for patterns that might indicate where owner name ends
        // Common pattern: Owner name, then address (which might have street numbers)
        const addressMatch = beforeAmount.match(/(\d+\s+[A-Z\s]+(?:CIR|DR|ST|RD|CT|WAY|PKWY|BLVD|AVE|LN|PL|TRL|RUN|CT|WAY))/i)
        
        if (addressMatch) {
          const addressStart = beforeAmount.indexOf(addressMatch[0])
          const ownerName = beforeAmount.substring(0, addressStart).trim()
          const situs = addressMatch[0].trim()
          
          parts = [pin, ownerName, situs, amountText]
        } else {
          // Fallback: assume last part before amount is address, rest is owner
          const lastSpaceIndex = beforeAmount.lastIndexOf('  ') // Look for double space
          if (lastSpaceIndex > 0) {
            const ownerName = beforeAmount.substring(0, lastSpaceIndex).trim()
            const situs = beforeAmount.substring(lastSpaceIndex).trim()
            parts = [pin, ownerName, situs, amountText]
          } else {
            // Just split roughly in half
            const midPoint = Math.floor(beforeAmount.length / 2)
            const ownerName = beforeAmount.substring(0, midPoint).trim()
            const situs = beforeAmount.substring(midPoint).trim()
            parts = [pin, ownerName, situs, amountText]
          }
        }
      }

      if (parts.length < 4) {
        return null
      }

      const pin = parts[0].trim()
      const ownerName = parts[1].trim()
      const situs = parts[2].trim()
      const amountText = parts[3].trim()

      // Validate PIN format
      if (!pin.match(/^R\d+\s+\d+[A-Z]?/)) {
        return null
      }

      // Validate amount format (should be number with optional comma and 2 decimals)
      if (!amountText.match(/^[\d,]+\.\d{2}$/)) {
        return null
      }

      const taxAmount = this.parseCurrency(amountText)
      
      // Clean the situs field - remove any owner name that might be at the beginning
      // The situs field should only contain the address, but sometimes owner names leak in
      const cleanedSitus = this.cleanAddressFromName(situs, ownerName)
      const { address, city, zip } = this.parseAddress(cleanedSitus)

      // Validate we have meaningful data
      if (!ownerName || ownerName.length < 2) {
        return null
      }
      if (!address || address.length < 3) {
        return null
      }

      return {
        parcel_id: pin,
        owner_name: ownerName,
        property_address: address,
        city: city || 'LAWRENCEVILLE', // Default city for Gwinnett County
        zip: zip || '',
        tax_amount_due: taxAmount,
        sale_date: saleDate
      }
    } catch (error) {
      console.error(`Error parsing table row: ${rowText.substring(0, 100)}`, error)
      return null
    }
  }
}
