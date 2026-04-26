CREATE TABLE IF NOT EXISTS pending_oauth (
  instance_id TEXT PRIMARY KEY,
  code        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_oauth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON pending_oauth
  FOR ALL USING (true) WITH CHECK (true);
