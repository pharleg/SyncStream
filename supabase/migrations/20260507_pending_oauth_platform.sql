ALTER TABLE pending_oauth DROP CONSTRAINT pending_oauth_pkey;
ALTER TABLE pending_oauth ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'gmc';
ALTER TABLE pending_oauth ADD PRIMARY KEY (instance_id, platform);
