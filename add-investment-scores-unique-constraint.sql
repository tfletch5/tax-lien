-- Add unique constraint on tax_lien_id to investment_scores table
-- This allows us to use ON CONFLICT in upsert operations
ALTER TABLE investment_scores 
ADD CONSTRAINT investment_scores_tax_lien_id_unique UNIQUE (tax_lien_id);
