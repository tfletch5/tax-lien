-- Users (handled by Supabase Auth, extended with profiles)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Counties reference table
CREATE TABLE counties (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT DEFAULT 'GA',
  scrape_url TEXT,
  last_scraped_at TIMESTAMPTZ
);

-- Tax Liens (scraped data)
CREATE TABLE tax_liens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_id INTEGER REFERENCES counties(id),
  parcel_id TEXT,
  owner_name TEXT,
  property_address TEXT,
  city TEXT,
  zip TEXT,
  tax_amount_due DECIMAL(12,2),
  sale_date DATE,
  legal_description TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(county_id, parcel_id)
);

-- Property details (from RealEstateAPI)
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_lien_id UUID REFERENCES tax_liens(id),
  estimated_value DECIMAL(12,2),
  last_sale_price DECIMAL(12,2),
  last_sale_date DATE,
  year_built INTEGER,
  bedrooms INTEGER,
  bathrooms DECIMAL(3,1),
  sqft INTEGER,
  lot_size_sqft INTEGER,
  property_type TEXT,
  mortgage_balance DECIMAL(12,2),
  enriched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Investment Analysis
CREATE TABLE investment_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_lien_id UUID REFERENCES tax_liens(id),
  ltv DECIMAL(5,2),              -- Loan-to-Value ratio
  equity_estimate DECIMAL(12,2),  -- Estimated equity
  investment_score INTEGER,       -- 1-100 score
  score_breakdown JSONB,          -- Detailed scoring factors
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scrape logs
CREATE TABLE scrape_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_id INTEGER REFERENCES counties(id),
  status TEXT,
  records_found INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Insert counties data
INSERT INTO counties (name, state, scrape_url) VALUES
('DeKalb', 'GA', 'https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html'),
('Gwinnett', 'GA', 'https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales'),
('Cobb', 'GA', 'https://www.cobbtax.gov/property/tax_sale/index.php'),
('Fulton', 'GA', 'https://fcsoga.org/tax-sales/'),
('Clayton', 'GA', 'https://publicaccess.claytoncountyga.gov/content/PDF/');

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_liens ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_scores ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Tax liens policies (authenticated users can read all)
CREATE POLICY "Authenticated users can view tax liens" ON tax_liens FOR SELECT USING (auth.role() = 'authenticated');

-- Properties policies
CREATE POLICY "Authenticated users can view properties" ON properties FOR SELECT USING (auth.role() = 'authenticated');

-- Investment scores policies
CREATE POLICY "Authenticated users can view investment scores" ON investment_scores FOR SELECT USING (auth.role() = 'authenticated');
