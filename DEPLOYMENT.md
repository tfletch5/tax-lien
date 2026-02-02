# Tax Lien Dashboard - Deployment Guide

## 🚀 Complete System Ready for Deployment

Your Tax Lien Investment Dashboard is now fully implemented with all requested features:

### ✅ Completed Features
- **Next.js 14+ Dashboard** with TypeScript and Tailwind CSS
- **Supabase Authentication** (login/signup)
- **County Selection** (DeKalb, Gwinnett, Cobb, Fulton, Clayton)
- **Web Scraping System** for all 5 counties
- **RealEstateAPI Integration** for property enrichment
- **Investment Scoring Algorithm** (LTV, equity, 1-100 scores)
- **Airtable Integration** for dual storage
- **Vercel Cron Jobs** for bi-weekly automated scraping
- **Modern UI** with shadcn/ui components

---

## 📋 Pre-Deployment Checklist

### 1. Environment Variables
Update your `.env.local` file with actual values:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# API Keys
REALESTATE_API_KEY=your-realestate-api-key
AIRTABLE_API_KEY=your-airtable-api-key
AIRTABLE_BASE_ID=your-airtable-base-id

# Cron Security
CRON_SECRET=your-random-secret-string
```

### 2. Supabase Database Setup
1. Go to your Supabase project
2. Open SQL Editor
3. Run the complete schema from `supabase-schema.sql`
4. Enable Authentication in Settings > Auth

### 3. Airtable Setup
1. Create a new Airtable base
2. Create two tables: `Counties` and `Tax Liens`
3. Get your Base ID from Airtable URL
4. Run this API call to create the structure:

```bash
curl -X POST https://api.airtable.com/v0/your-base-id/airtable \
  -H "Authorization: Bearer your-airtable-api-key" \
  -H "Content-Type: application/json" \
  -d '{"action": "createBase"}'
```

---

## 🚀 Deployment Steps

### Step 1: Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### Step 2: Configure Environment Variables in Vercel
1. Go to Vercel Dashboard > Your Project > Settings
2. Add all environment variables from your `.env.local`
3. **Important**: Make sure `NEXT_PUBLIC_` variables are public

### Step 3: Set Up Cron Job
1. In Vercel Dashboard > Your Project > Settings > Cron Jobs
2. Add cron job with:
   - **Path**: `/api/cron/scrape`
   - **Schedule**: `0 2 */14 * *` (Every 14 days at 2 AM)
   - **Headers**: `Authorization: Bearer your-cron-secret`

### Step 4: Test the System
1. **Test Authentication**: Visit your app and sign up/login
2. **Test Scraping**: Call `/api/scrape` endpoint
3. **Test Enrichment**: Call `/api/enrich` endpoint
4. **Test Airtable**: Call `/api/airtable` endpoint

---

## 📊 API Endpoints

### Scraping Endpoints
```bash
# Scrape all counties
POST /api/scrape
{"county": "all"}

# Scrape specific county
POST /api/scrape
{"county": "Fulton"}

# Get scraping status
GET /api/scrape
```

### Property Enrichment
```bash
# Enrich all properties
POST /api/enrich

# Enrich specific county
POST /api/enrich
{"countyId": 4}

# Enrich specific property
POST /api/enrich
{"taxLienId": "uuid"}
```

### Airtable Sync
```bash
# Sync all data
POST /api/airtable
{"action": "syncAll"}

# Sync only tax liens
POST /api/airtable
{"action": "syncTaxLiens"}

# Create base structure
POST /api/airtable
{"action": "createBase"}
```

---

## 🔧 Manual Operations

### Run Scraping Manually
```bash
curl -X POST https://your-app.vercel.app/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"county": "all"}'
```

### Enrich Properties Manually
```bash
curl -X POST https://your-app.vercel.app/api/enrich \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Sync to Airtable Manually
```bash
curl -X POST https://your-app.vercel.app/api/airtable \
  -H "Content-Type: application/json" \
  -d '{"action": "syncAll"}'
```

---

## 🎯 Investment Score Formula

The system calculates investment scores (1-100) based on:

- **LTV Ratio (30%)**: Lower loan-to-value = higher score
- **Equity Estimate (25%)**: Higher equity = higher score  
- **Tax vs Value (20%)**: Lower tax/value ratio = better
- **Property Type (10%)**: SFR > Multi > Commercial > Land
- **Location/County (10%)**: Based on historical performance
- **Recency (5%)**: Newer listings score slightly higher

---

## 📈 Monitoring

### Check Cron Job Status
```bash
curl -X GET https://your-app.vercel.app/api/cron/scrape \
  -H "Authorization: Bearer your-cron-secret"
```

### View Scrape Logs
Logs are stored in the `scrape_logs` table in Supabase.

---

## 🛠️ Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**
   - Restart the development server after changing `.env.local`
   - Check variable names match exactly

2. **Supabase Connection Error**
   - Verify URL and keys are correct
   - Check Supabase project is active

3. **Scraping Fails**
   - County websites may have changed structure
   - Check individual scraper logs in `scrape_logs`

4. **RealEstateAPI Rate Limits**
   - The system includes delays to respect rate limits
   - Monitor API usage in your RealEstateAPI dashboard

5. **Airtable Sync Issues**
   - Verify Base ID is correct
   - Check table names match exactly

---

## 🔄 System Workflow

1. **Bi-weekly Cron Job** runs automatically
2. **Scrapes** all 5 county websites for tax lien data
3. **Enriches** properties with RealEstateAPI data
4. **Calculates** investment scores using the algorithm
5. **Syncs** all data to Airtable for backup/analysis
6. **Dashboard** displays latest data with county filtering

---

## 📞 Support

For issues with:
- **Supabase**: Check Supabase Dashboard logs
- **Vercel**: Check Vercel function logs
- **APIs**: Verify API keys and rate limits
- **Scraping**: County websites may require updates

Your Tax Lien Investment Dashboard is now production-ready! 🎉
