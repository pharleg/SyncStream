-- 002: Fix double-encoded field_mappings data
-- The field_mappings column contains JSON strings instead of actual JSON objects
-- This converts them to proper JSONB

UPDATE app_config
SET field_mappings = field_mappings::text::jsonb
WHERE jsonb_typeof(field_mappings) = 'string';
