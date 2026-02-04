-- Add valuation columns to properties table
ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS avm_min DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS avm_max DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS confidence INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN properties.avm_min IS 'Minimum AVM (Automated Valuation Model) value from valuation API';
COMMENT ON COLUMN properties.avm_max IS 'Maximum AVM (Automated Valuation Model) value from valuation API';
COMMENT ON COLUMN properties.confidence IS 'Confidence score (0-100) for the AVM valuation';
