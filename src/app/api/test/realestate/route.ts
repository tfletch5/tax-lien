import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'

export async function POST(request: NextRequest) {
  try {
    const { address, city, zip } = await request.json()
    
    console.log('Testing RealEstateAPI with:', { address, city, zip })
    
    const apiKey = process.env.REALESTATE_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'REALESTATE_API_KEY not found' }, { status: 500 })
    }
    
    const fullAddress = [address, city, zip].filter(Boolean).join(', ')
    console.log('Full address:', fullAddress)
    console.log('API Key exists:', !!apiKey)
    console.log('API Key length:', apiKey.length)
    
    // Test different endpoint formats
    const endpoints = [
      'https://api.realestateapi.com/v2/property',
      'https://realestateapi.com/v2/property', 
      'https://api.realestateapi.com/property',
      'https://realestateapi.com/property'
    ]
    
    for (const endpoint of endpoints) {
      try {
        console.log(`Testing endpoint: ${endpoint}`)
        
        const response = await axios.get(endpoint, {
          params: {
            address: fullAddress,
            apiKey: apiKey
          },
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'TaxLienDashboard/1.0'
          },
          timeout: 10000
        })
        
        console.log(`✅ Success with ${endpoint}:`, response.status)
        return NextResponse.json({
          success: true,
          endpoint,
          data: response.data,
          status: response.status
        })
        
      } catch (error: any) {
        console.log(`❌ Failed with ${endpoint}:`, error.response?.status || error.message)
        
        if (error.response?.status === 404) {
          continue // Try next endpoint
        }
        
        // For other errors, return details
        return NextResponse.json({
          success: false,
          endpoint,
          error: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        })
      }
    }
    
    return NextResponse.json({
      success: false,
      error: 'All endpoints returned 404. Please check API documentation.',
      testedEndpoints: endpoints
    })
    
  } catch (error: any) {
    console.error('Test error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
