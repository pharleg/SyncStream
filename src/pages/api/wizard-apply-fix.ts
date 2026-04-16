/**
 * POST /api/wizard-apply-fix
 *
 * Applies a single wizard fix — either product-level (title/description → Wix)
 * or global (brand/condition → AppConfig.fieldMappings).
 *
 * Body (product fix):
 *   { type: 'product'; productId: string; title?: string; description?: string; instanceId?: string }
 *
 * Body (global fix):
 *   { type: 'global'; field: 'brand' | 'condition'; value: string; instanceId?: string }
 *
 * Response: { success: boolean; error?: string }
 */
import type { APIRoute } from 'astro';
import { getAppConfig, saveAppConfig, updateCachedProductFields } from '../../backend/dataService';
import { applyEnhancementsToWix } from '../../backend/aiEnhancer';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId: string = body.instanceId ?? 'default';

    // ── Product fix: write title/description to Wix ──────────────────────
    if (body.type === 'product') {
      const { productId, title, description } = body as {
        productId: string;
        title?: string;
        description?: string;
      };

      if (!productId) {
        return new Response(JSON.stringify({ success: false, error: 'productId required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!title && !description) {
        return new Response(JSON.stringify({ success: false, error: 'title or description required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }

      const results = await applyEnhancementsToWix(instanceId, [{
        productId,
        title: title ?? '',
        description: description ?? '',
      }]);

      const result = results[0];
      if (!result.success) {
        return new Response(
          JSON.stringify({ success: false, error: result.error ?? 'Wix update failed' }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Update products cache
      const cacheFields: { name?: string; description?: string; plainDescription?: string } = {};
      if (title) { cacheFields.name = title; }
      if (description) { cacheFields.description = description; cacheFields.plainDescription = description; }
      await updateCachedProductFields(instanceId, productId, cacheFields);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Global fix: write brand/condition to AppConfig.fieldMappings ─────
    if (body.type === 'global') {
      const { field, value } = body as { field: 'brand' | 'condition'; value: string };

      if (!field || !value) {
        return new Response(JSON.stringify({ success: false, error: 'field and value required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }

      const config = await getAppConfig(instanceId);
      if (!config) {
        return new Response(JSON.stringify({ success: false, error: 'AppConfig not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }

      config.fieldMappings = {
        ...config.fieldMappings,
        [field]: { type: 'default', defaultValue: value },
      };
      await saveAppConfig(config);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'type must be "product" or "global"' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
