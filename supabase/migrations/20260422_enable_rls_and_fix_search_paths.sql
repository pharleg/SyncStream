-- Enable RLS on all backend-only tables (Edge Functions use service role, bypasses RLS)
-- No policies needed — direct client access blocked entirely

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enhanced_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmc_field_overrides ENABLE ROW LEVEL SECURITY;

-- Fix mutable search_path on functions (prevents search_path hijack)
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.get_sync_context(text, text[], text) SET search_path = public;
