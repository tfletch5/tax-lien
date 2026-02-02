# Tax Lien Investment Dashboard

A Next.js dashboard for analyzing tax lien investment opportunities across Georgia counties.

## Features

- **Authentication**: Secure login/signup with Supabase Auth
- **County Selection**: Dropdown to filter tax lien data by county (DeKalb, Gwinnett, Cobb, Fulton, Clayton)
- **Investment Analysis**: LTV calculations, equity estimates, and investment scoring
- **Data Enrichment**: Integration with RealEstateAPI for property details
- **Automated Scraping**: Bi-weekly cron jobs to collect tax lien data
- **Dual Storage**: Data stored in both Supabase and Airtable

## Tech Stack

- **Frontend**: Next.js 14+ with TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (PostgreSQL) + Supabase Auth
- **APIs**: RealEstateAPI v2, Airtable API
- **Deployment**: Vercel with cron jobs

## Setup Instructions

### 1. Environment Variables

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
REALESTATE_API_KEY=your_realestate_api_key
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=your_airtable_base_id
```

### 2. Database Setup

Run the SQL schema in `supabase-schema.sql` in your Supabase project:

```bash
# Copy and run the SQL in Supabase SQL Editor
cat supabase-schema.sql
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Database Schema

### Tables

- **profiles**: User profiles linked to Supabase Auth
- **counties**: Georgia counties with scraping URLs
- **tax_liens**: Scraped tax lien data
- **properties**: Property details from RealEstateAPI
- **investment_scores**: Calculated LTV, equity, and investment scores
- **scrape_logs**: Web scraping operation logs

## Investment Score Formula

The investment score (1-100) is calculated based on:

- **LTV Ratio (30%)**: Lower loan-to-value = higher score
- **Equity Estimate (25%)**: Higher equity = higher score
- **Tax vs Value (20%)**: Lower tax/value ratio = better
- **Property Type (10%)**: SFR > Multi > Commercial > Land
- **Location/County (10%)**: Based on historical performance
- **Recency (5%)**: Newer listings score slightly higher

## County Data Sources

| County   | Data Source       | Format     |
| -------- | ----------------- | ---------- |
| DeKalb   | Tax Sale Listing  | HTML       |
| Gwinnett | Tax Liens & Sales | HTML + PDF |
| Cobb     | Tax Sales         | HTML + PDF |
| Fulton   | Sheriff's Sales   | PDF        |
| Clayton  | Tax Sale Listings | PDF        |

## Deployment

Deploy to Vercel:

```bash
vercel --prod
```

Configure environment variables in Vercel dashboard and set up cron jobs for bi-weekly scraping.

## Development

### Adding New Counties

1. Add county to `counties` table
2. Implement scraper in `src/lib/scrapers/`
3. Update county list in dashboard

### Modifying Investment Score

Edit the `calculateInvestmentScore` function in `src/lib/utils.ts`.

## License

MIT
