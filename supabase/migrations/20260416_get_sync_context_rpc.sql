CREATE OR REPLACE FUNCTION get_sync_context(
  p_instance_id text,
  p_product_ids text[],
  p_platform text DEFAULT 'gmc'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN jsonb_build_object(
    'config', (
      SELECT row_to_json(ac)
      FROM (
        SELECT instance_id, gmc_connected, meta_connected, field_mappings,
               sync_enabled, last_full_sync, gmc_data_source_id,
               ai_enhancement_enabled, ai_enhancement_style, setup_screen_shown
        FROM app_config
        WHERE instance_id = p_instance_id
        LIMIT 1
      ) ac
    ),
    'filters', COALESCE((
      SELECT jsonb_agg(row_to_json(f) ORDER BY f.order)
      FROM sync_filters f
      WHERE f.instance_id = p_instance_id
        AND f.platform IN (p_platform, 'both')
        AND f.enabled = true
    ), '[]'::jsonb),
    'rules', COALESCE((
      SELECT jsonb_agg(row_to_json(r) ORDER BY r.order)
      FROM sync_rules r
      WHERE r.instance_id = p_instance_id
        AND r.platform IN (p_platform, 'both')
        AND r.enabled = true
    ), '[]'::jsonb),
    'platformSettings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', sub.product_id,
        'platforms', sub.platforms
      ))
      FROM (
        SELECT DISTINCT ON (product_id) product_id, platforms
        FROM sync_state
        WHERE product_id = ANY(p_product_ids)
          AND platforms IS NOT NULL
      ) sub
    ), '[]'::jsonb),
    'overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productId', o.product_id,
        'field', o.field_name,
        'value', o.override_value
      ))
      FROM gmc_field_overrides o
      WHERE o.product_id = ANY(p_product_ids)
    ), '[]'::jsonb),
    'enhancements', COALESCE((
      SELECT jsonb_agg(row_to_json(e))
      FROM enhanced_content e
      WHERE e.instance_id = p_instance_id
        AND e.product_id = ANY(p_product_ids)
    ), '[]'::jsonb)
  );
END;
$$;
