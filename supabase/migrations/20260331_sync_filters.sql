CREATE TABLE IF NOT EXISTS sync_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('gmc', 'meta', 'both')),
  field text NOT NULL,
  operator text NOT NULL CHECK (operator IN ('equals', 'not_equals', 'contains', 'greater_than', 'less_than')),
  value text NOT NULL,
  condition_group text NOT NULL DEFAULT 'AND' CHECK (condition_group IN ('AND', 'OR')),
  "order" integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_filters_instance ON sync_filters(instance_id);
