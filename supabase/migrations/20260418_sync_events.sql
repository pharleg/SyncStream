-- supabase/migrations/20260418_sync_events.sql

CREATE TABLE IF NOT EXISTS sync_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  text NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN ('sync_complete', 'sync_error', 'compliance_check', 'manual_fix')),
  message      text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('success', 'error', 'info', 'warning')),
  product_count int,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_events_instance_created
  ON sync_events (instance_id, created_at DESC);
