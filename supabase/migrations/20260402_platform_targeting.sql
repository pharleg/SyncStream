-- Add per-product platform targeting
-- Default to all platforms (null = sync to all connected platforms)
ALTER TABLE sync_state ADD COLUMN platforms TEXT[] DEFAULT NULL;

-- Index for filtering by platform targeting
CREATE INDEX idx_sync_state_platforms ON sync_state USING GIN (platforms);

COMMENT ON COLUMN sync_state.platforms IS
  'Platforms this product should sync to. NULL = all connected platforms. e.g. {gmc,meta}';
