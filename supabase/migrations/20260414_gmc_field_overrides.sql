-- Per-product GMC field overrides
-- Stored when merchant applies compliance fixes to GMC only.
-- Applied during sync in syncService before pushing to GMC.
CREATE TABLE IF NOT EXISTS gmc_field_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  field_name text NOT NULL,
  override_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmc_field_overrides_product_field_unique UNIQUE (product_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_gmc_overrides_product_id ON gmc_field_overrides (product_id);
