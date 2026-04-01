CREATE TABLE IF NOT EXISTS products_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  product_id text NOT NULL,
  name text NOT NULL,
  image_url text,
  price text,
  currency text DEFAULT 'USD',
  availability text,
  variant_count integer DEFAULT 1,
  description text,
  plain_description text,
  brand text,
  slug text,
  product_data jsonb NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, product_id)
);

CREATE INDEX idx_products_cache_instance ON products_cache(instance_id);
