ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS ai_enhancement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_enhancement_style text;
