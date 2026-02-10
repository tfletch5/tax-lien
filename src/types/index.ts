export interface County {
  id: number
  name: string
  state: string
  scrape_url: string
  last_scraped_at?: string
}

export interface TaxLien {
  id: string
  county_id: number
  parcel_id: string
  owner_name: string
  property_address: string
  city?: string
  zip?: string
  tax_amount_due: number
  sale_date?: string
  legal_description?: string
  scraped_at: string
  county?: County
  property?: Property
  investment_score?: InvestmentScore
}

export interface Property {
  id: string
  tax_lien_id: string
  estimated_value?: number
  last_sale_price?: number
  last_sale_date?: string
  year_built?: number
  bedrooms?: number
  bathrooms?: number
  sqft?: number
  lot_size_sqft?: number
  property_type?: string
  mortgage_balance?: number
  enriched_at: string
  confidence?: number
}

export interface InvestmentScore {
  id: string
  tax_lien_id: string
  ltv?: number
  equity_estimate?: number
  investment_score: number
  score_breakdown?: Record<string, number>
  calculated_at: string
}

export interface ScrapeLog {
  id: string
  county_id: number
  status: string
  records_found?: number
  error_message?: string
  started_at: string
  completed_at?: string
}

export interface Profile {
  id: string
  email?: string
  full_name?: string
  created_at: string
}

export interface ScoreBreakdown {
  ltv: number
  equity: number
  taxRatio: number
  propertyType: number
  location: number
  recency: number
}
