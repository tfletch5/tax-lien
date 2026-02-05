/**
 * Wrapper for PDF parsing with fallback support
 * Tries pdf2json first, falls back to pdf-parse, then OCR if both fail
 */

export async function parsePdf(buffer: Buffer): Promise<{ text: string }> {
  // First, try pdf2json (doesn't require browser APIs)
  try {
    return await parsePdfWithPdf2json(buffer)
  } catch (error: any) {
    console.warn('pdf2json failed, trying pdf-parse fallback:', error.message)
    // Fallback to pdf-parse
    try {
      return await parsePdfWithPdfParse(buffer)
    } catch (fallbackError: any) {
      console.warn('pdf-parse also failed, trying OCR fallback:', fallbackError.message)
      // Final fallback: OCR for image-based PDFs
      try {
        return await parsePdfWithOCR(buffer)
      } catch (ocrError: any) {
        console.error('All PDF parsing methods failed:', {
          pdf2json: error.message,
          pdfParse: fallbackError.message,
          ocr: ocrError.message
        })
        throw new Error(`PDF parsing failed: ${error.message}. All fallbacks failed.`)
      }
    }
  }
}

async function parsePdfWithPdf2json(buffer: Buffer): Promise<{ text: string }> {
  // Use pdf2json instead of pdf-parse to avoid browser API dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json')
  
  return new Promise((resolve, reject) => {
    // Create PDFParser instance
    // pdf2json constructor: PDFParser(streaming, max)
    const pdfParser = new PDFParser(null, 1)
    
    // Set up error handler
    pdfParser.on('pdfParser_dataError', (errData: any) => {
      const errorMsg = errData?.parserError || errData?.message || 'Unknown PDF parsing error'
      console.error('PDF parsing error:', errorMsg)
      reject(new Error(`PDF parsing failed: ${errorMsg}`))
    })
    
    // Set up success handler
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
        // Extract text from all pages
        let fullText = ''
        
        if (pdfData && pdfData.Pages && Array.isArray(pdfData.Pages)) {
          console.log(`PDF has ${pdfData.Pages.length} page(s)`)
          for (let pageIdx = 0; pageIdx < pdfData.Pages.length; pageIdx++) {
            const page = pdfData.Pages[pageIdx]
            console.log(`Page ${pageIdx + 1} structure:`, {
              hasTexts: !!page.Texts,
              textsIsArray: Array.isArray(page.Texts),
              textsLength: page.Texts?.length || 0,
              pageKeys: Object.keys(page)
            })
            
            if (page.Texts && Array.isArray(page.Texts)) {
              console.log(`Page ${pageIdx + 1} has ${page.Texts.length} text elements`)
              // Extract text from each text element on the page
              // pdf2json structures text as: Texts[].R[].T
              for (let textIdx = 0; textIdx < page.Texts.length; textIdx++) {
                const textObj = page.Texts[textIdx]
                
                // Try multiple ways to extract text
                if (textObj.R && Array.isArray(textObj.R)) {
                  for (const run of textObj.R) {
                    if (run.T) {
                      // Decode URI-encoded text (pdf2json URI-encodes special characters)
                      try {
                        fullText += decodeURIComponent(run.T) + ' '
                      } catch {
                        // If decoding fails, use the text as-is
                        fullText += run.T + ' '
                      }
                    }
                  }
                } else if (textObj.T) {
                  // Some PDFs might have text directly in T property
                  try {
                    fullText += decodeURIComponent(textObj.T) + ' '
                  } catch {
                    fullText += textObj.T + ' '
                  }
                } else if (textObj.w) {
                  // Some PDFs use 'w' property for text width/position, text might be elsewhere
                  // Check if there's text in other properties
                  if (textObj.text) {
                    fullText += textObj.text + ' '
                  }
                }
                
                // Log first few text objects for debugging
                if (textIdx < 3) {
                  console.log(`Text object ${textIdx} sample:`, JSON.stringify(textObj).substring(0, 200))
                }
              }
            } else {
              console.warn(`Page ${pageIdx + 1} has no Texts array or it's not an array`)
              // Try alternative text extraction methods
              if (page.Fills && Array.isArray(page.Fills)) {
                console.log(`Page ${pageIdx + 1} has ${page.Fills.length} fills (might be image-based)`)
              }
              
              // Try to extract text from other possible structures
              // Some PDFs store text in different properties
              if (page.rawText) {
                console.log(`Found rawText property on page ${pageIdx + 1}`)
                fullText += page.rawText + ' '
              }
              
              // Check for text in other page properties
              for (const key of Object.keys(page)) {
                if (key.toLowerCase().includes('text') && typeof page[key] === 'string') {
                  console.log(`Found text in page property: ${key}`)
                  fullText += page[key] + ' '
                }
              }
            }
          }
        } else {
          console.warn('PDF data structure unexpected:', {
            hasPdfData: !!pdfData,
            hasPages: !!pdfData?.Pages,
            pagesIsArray: Array.isArray(pdfData?.Pages),
            pdfDataKeys: Object.keys(pdfData || {})
          })
        }
        
        // Clean up the text (remove extra spaces, normalize newlines)
        let cleanedText = fullText
          .replace(/\s+/g, ' ') // Replace multiple spaces with single space
          .replace(/\n\s*\n/g, '\n') // Remove empty lines
          .trim()
        
        if (cleanedText.length === 0) {
          console.warn('⚠️ No text extracted from PDF using pdf2json')
          console.warn('PDF structure summary:', {
            hasPages: !!pdfData.Pages,
            pageCount: pdfData.Pages?.length || 0,
            firstPageKeys: pdfData.Pages?.[0] ? Object.keys(pdfData.Pages[0]) : [],
            samplePageData: pdfData.Pages?.[0] ? JSON.stringify(pdfData.Pages[0]).substring(0, 500) : 'N/A'
          })
          
          // Try to extract text from the raw PDF data structure
          // Some PDFs might have text in a different location
          try {
            const pdfDataStr = JSON.stringify(pdfData)
            // Look for common text patterns in the JSON structure
            // Pattern: "T":"text" or "T": "text" (with or without spaces)
            const textMatches = pdfDataStr.match(/"T"\s*:\s*"([^"]+)"/g)
            if (textMatches && textMatches.length > 0) {
              console.log(`Found ${textMatches.length} potential text matches in raw data structure`)
              let extractedCount = 0
              for (const match of textMatches) {
                try {
                  // Extract the text value from the match
                  const textMatch = match.match(/"T"\s*:\s*"([^"]+)"/)
                  if (textMatch && textMatch[1]) {
                    let textValue = textMatch[1]
                    // Try to decode URI-encoded text
                    try {
                      textValue = decodeURIComponent(textValue)
                    } catch {
                      // If decoding fails, use as-is
                    }
                    if (textValue && textValue.length > 0) {
                      fullText += textValue + ' '
                      extractedCount++
                    }
                  }
                } catch {
                  // Skip invalid matches
                }
              }
              
              if (extractedCount > 0) {
                console.log(`Extracted text from ${extractedCount} text elements`)
                // Re-clean the text
                cleanedText = fullText
                  .replace(/\s+/g, ' ')
                  .replace(/\n\s*\n/g, '\n')
                  .trim()
                
                if (cleanedText.length > 0) {
                  console.log(`✅ Extracted ${cleanedText.length} characters using alternative method`)
                }
              } else {
                console.warn('Found text matches but failed to extract any text values')
              }
            } else {
              console.warn('No text patterns found in raw PDF data structure')
            }
          } catch (altError: any) {
            console.warn('Alternative text extraction also failed:', altError?.message || altError)
          }
          
          // If still no text, throw error to trigger fallback
          if (cleanedText.length === 0) {
            reject(new Error('No text extracted from PDF - may be image-based (scanned PDF)'))
            return
          }
        } else {
          console.log(`✅ Extracted ${cleanedText.length} characters from PDF using pdf2json`)
        }
        
        resolve({ text: cleanedText })
      } catch (error: any) {
        console.error('Error extracting text from PDF data:', error.message)
        reject(new Error(`Failed to extract text from PDF: ${error.message}`))
      }
    })
    
    // Parse the buffer
    try {
      pdfParser.parseBuffer(buffer)
    } catch (error: any) {
      reject(new Error(`Failed to parse PDF buffer: ${error.message}`))
    }
  })
}

async function parsePdfWithPdfParse(buffer: Buffer): Promise<{ text: string }> {
  // Fallback to pdf-parse when pdf2json fails
  // pdf-parse works better with some PDF formats but requires browser APIs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse')
  
  try {
    // Handle different export formats of pdf-parse
    let pdfParseFn = pdfParse
    if (typeof pdfParse !== 'function') {
      if (pdfParse.default && typeof pdfParse.default === 'function') {
        pdfParseFn = pdfParse.default
      } else if (pdfParse.pdfParse && typeof pdfParse.pdfParse === 'function') {
        pdfParseFn = pdfParse.pdfParse
      } else {
        throw new Error('pdf-parse function not found in module')
      }
    }
    
    const result = await pdfParseFn(buffer)
    const text = result.text || ''
    
    if (text.length === 0) {
      throw new Error('pdf-parse extracted no text - may be image-based')
    }
    
    return { text }
  } catch (error: any) {
    throw new Error(`pdf-parse failed: ${error.message}`)
  }
}

async function parsePdfWithOCR(buffer: Buffer): Promise<{ text: string }> {
  // OCR fallback for image-based (scanned) PDFs
  // NOTE: OCR is currently disabled due to native module resolution issues in Next.js/Turbopack
  // Turbopack tries to resolve require() statements at build time, causing errors with native modules
  // To enable OCR, you'll need to use --webpack flag: npm run dev -- --webpack
  console.log('🔄 OCR extraction is currently disabled due to build compatibility issues.')
  console.log('💡 To use OCR, run the dev server with: npm run dev -- --webpack')
  throw new Error('OCR is currently disabled. Image-based PDFs require OCR which needs webpack instead of Turbopack. Run: npm run dev -- --webpack')
  
  /* OCR implementation - disabled to avoid build errors with Turbopack
  // All require() statements are commented out to prevent Turbopack from resolving them at build time
  // To enable OCR, uncomment this code and run: npm run dev -- --webpack
  
  // All require() calls must be commented out:
  // const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs')
  // const canvasModule = require('@napi-rs/canvas')
  // const sharp = require('sharp')
  // const { createWorker } = require('tesseract.js')
  
  // Rest of OCR implementation would go here...
  */
}
