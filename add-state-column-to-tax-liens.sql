-- Add state column to tax_liens table
ALTER TABLE tax_liens
ADD COLUMN IF NOT EXISTS state TEXT;

COMMENT ON COLUMN tax_liens.state IS 'State from property enrichment data';
