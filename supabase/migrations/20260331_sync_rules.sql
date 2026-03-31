CREATE TABLE IF NOT EXISTS sync_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('gmc', 'meta', 'both')),
  field text NOT NULL,
  type text NOT NULL CHECK (type IN ('concatenate', 'static', 'calculator')),
  expression jsonb NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_rules_instance ON sync_rules(instance_id);
