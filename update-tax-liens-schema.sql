-- Updated Tax Liens table for DeKalb County with all fields
ALTER TABLE tax_liens 
ADD COLUMN tax_sale_date DATE,
ADD COLUMN map_ref TEXT,
ADD COLUMN tax_sale_id TEXT,
ADD COLUMN tenant TEXT,
ADD COLUMN defendant TEXT,
ADD COLUMN levy_type TEXT,
ADD COLUMN lien_book TEXT,
ADD COLUMN page TEXT,
ADD COLUMN levy_date DATE,
ADD COLUMN min_year INTEGER,
ADD COLUMN max_year INTEGER;

-- Update the unique constraint to include tax_sale_id for DeKalb
-- First drop the existing constraint
ALTER TABLE tax_liens DROP CONSTRAINT IF EXISTS tax_liens_county_id_parcel_id_key;

-- Add new constraint that includes tax_sale_id for uniqueness
ALTER TABLE tax_liens 
ADD CONSTRAINT tax_liens_unique 
UNIQUE(county_id, parcel_id, tax_sale_id);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tax_liens_county_parcel ON tax_liens(county_id, parcel_id);
CREATE INDEX IF NOT EXISTS idx_tax_liens_sale_date ON tax_liens(tax_sale_date);
CREATE INDEX IF NOT EXISTS idx_tax_liens_owner_name ON tax_liens(owner_name);

-- Update the scraper to use the new fields
-- The scraper will now populate:
-- tax_sale_date -> tax_sale_date (from Tax Sale Date)
-- parcel_id -> parcel_id (from Parcel ID)
-- map_ref -> map_ref (from Map Ref)
-- tax_sale_id -> tax_sale_id (from Tax Sale ID)
-- owner_name -> owner_name (from Owner)
-- property_address -> property_address (from Address)
-- tenant -> tenant (from Tenant)
-- defendant -> defendant (from Defendant)
-- levy_type -> levy_type (from Levy Type)
-- lien_book -> lien_book (from Lien Book)
-- page -> page (from Page)
-- levy_date -> levy_date (from Levy Date)
-- min_year -> min_year (from Min Year)
-- max_year -> max_year (from Max Year)
-- tax_amount_due -> tax_amount_due (from Total Tax Due)
