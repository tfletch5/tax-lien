# DeKalb County Tax Lien Dashboard - Quick Start

## 🚀 Focused on DeKalb County Only

Perfect choice! Starting with DeKalb County allows us to test and validate the system before expanding to other counties.

## 📋 Quick Setup

### 1. Environment Variables
Update your `.env.local` file:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# API Keys (Optional for now)
REALESTATE_API_KEY=your-realestate-api-key
AIRTABLE_API_KEY=your-airtable-api-key
AIRTABLE_BASE_ID=your-airtable-base-id

# Cron Security
CRON_SECRET=your-random-secret-string
```

### 2. Supabase Database Setup
1. Go to your Supabase project
2. Open SQL Editor
3. Run this simplified schema:

```sql
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

-- Insert DeKalb County
INSERT INTO counties (id, name, state, scrape_url) VALUES 
(1, 'DeKalb', 'GA', 'https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html');

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
  ltv DECIMAL(5,2),
  equity_estimate DECIMAL(12,2),
  investment_score INTEGER,
  score_breakdown JSONB,
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
```

4. Enable Authentication in Supabase Settings > Auth

### 3. Start the App
```bash
npm run dev
```

## 🎯 How to Use

### 1. Sign Up/Login
- Visit `http://localhost:3000`
- Create an account or sign in

### 2. Scrape DeKalb Data
- Click the **"Scrape DeKalb"** button
- The system will fetch tax lien data from DeKalb County
- Wait for the success message

### 3. View Results
- Browse the tax lien properties in the table
- See investment scores (1-100 scale)
- Filter and sort by different metrics

## 📊 What You'll See

### Dashboard Features
- **Total Properties**: Number of tax liens found
- **Total Tax Value**: Sum of all tax amounts due
- **Avg Investment Score**: Average opportunity score
- **Property Table**: Detailed view of each tax lien

### Investment Scoring
Each property gets a score based on:
- **LTV Ratio** (30%): Lower loan-to-value = higher score
- **Equity Estimate** (25%): Higher equity = higher score
- **Tax vs Value** (20%): Lower tax/value ratio = better
- **Property Type** (10%): SFR > Multi > Commercial > Land
- **Location** (10%): DeKalb County specific factors
- **Recency** (5%): Newer listings score slightly higher

## 🔧 API Endpoints

### Manual Scraping
```bash
# Scrape DeKalb County
curl -X POST http://localhost:3000/api/scrape/dekalb

# Get current data
curl http://localhost:3000/api/scrape/dekalb
```

### Property Enrichment (Optional)
```bash
# Enrich DeKalb properties with RealEstateAPI
curl -X POST http://localhost:3000/api/enrich -d '{"countyId": 1}'
```

### Airtable Sync (Optional)
```bash
# Sync DeKalb data to Airtable
curl -X POST http://localhost:3000/api/airtable -d '{"action": "syncTaxLiens"}'
```

## 🚀 Deployment

### Deploy to Vercel
```bash
vercel --prod
```

### Configure Environment Variables
Add all environment variables to Vercel dashboard settings.

### Set Up Cron Job
1. Go to Vercel Dashboard > Your Project > Settings > Cron Jobs
2. Add cron job:
   - **Path**: `/api/cron/dekalb`
   - **Schedule**: `0 2 */14 * *` (Every 14 days at 2 AM)
   - **Headers**: `Authorization: Bearer your-cron-secret`

## 🎯 Next Steps

Once DeKalb County is working perfectly:

1. **Test the System**: Verify scraping, scoring, and display
2. **Add RealEstateAPI**: Enrich properties with additional data
3. **Add Airtable**: Set up dual storage
4. **Expand Counties**: Add Gwinnett, Cobb, Fulton, and Clayton

## 🐛 Troubleshooting

### Common Issues

1. **"No tax lien data found"**
   - Click "Scrape DeKalb" button first
   - Check the browser console for errors

2. **Scraping fails**
   - DeKalb County website may have changed
   - Check the scrape logs in Supabase

3. **Environment variables not loading**
   - Restart the dev server after changing `.env.local`
   - Verify variable names match exactly

4. **Supabase connection error**
   - Check your Supabase URL and keys
   - Ensure the database schema is set up correctly

## 📈 Success Metrics

You'll know it's working when:
- ✅ You can sign up/login successfully
- ✅ "Scrape DeKalb" button works and shows success message
- ✅ Tax lien properties appear in the table
- ✅ Investment scores are calculated (1-100)
- ✅ Dashboard shows statistics

Start with DeKalb County, validate everything works, then we can expand to the other 4 counties! 🎉
