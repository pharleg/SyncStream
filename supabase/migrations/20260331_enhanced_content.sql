CREATE TABLE IF NOT EXISTS enhanced_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  product_id text NOT NULL,
  platform text NOT NULL DEFAULT 'both' CHECK (platform IN ('gmc', 'meta', 'both')),
  enhanced_title text,
  enhanced_description text NOT NULL,
  source_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, product_id, platform)
);

CREATE INDEX idx_enhanced_content_lookup ON enhanced_content(instance_id, product_id);
