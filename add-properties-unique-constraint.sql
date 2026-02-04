-- Add unique constraint on tax_lien_id to properties table
-- This allows us to use ON CONFLICT in upsert operations
ALTER TABLE properties 
ADD CONSTRAINT properties_tax_lien_id_unique UNIQUE (tax_lien_id);
