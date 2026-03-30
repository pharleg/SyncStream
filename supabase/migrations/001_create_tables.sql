-- 001: Create AppConfig and SyncState tables
-- Run this in Supabase SQL Editor

-- AppConfig table
CREATE TABLE app_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT UNIQUE NOT NULL,
  gmc_connected BOOLEAN DEFAULT FALSE,
  meta_connected BOOLEAN DEFAULT FALSE,
  field_mappings JSONB DEFAULT '{}'::jsonb,
  sync_enabled BOOLEAN DEFAULT FALSE,
  last_full_sync TIMESTAMPTZ,
  gmc_data_source_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SyncState table
CREATE TABLE sync_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('gmc', 'meta')),
  status TEXT NOT NULL CHECK (status IN ('synced', 'error', 'pending')),
  last_synced TIMESTAMPTZ DEFAULT NOW(),
  error_log JSONB,
  external_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, platform)
);

-- Indexes for fast lookups
CREATE INDEX idx_sync_state_last_synced ON sync_state (last_synced DESC);
CREATE INDEX idx_sync_state_status ON sync_state (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_config_updated_at
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sync_state_updated_at
  BEFORE UPDATE ON sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
