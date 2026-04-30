/**
 * POST /api/products-apply-ai
 * Two modes:
 *   - preview: { instanceId, productIds } → returns before/after for each product
 *   - apply:   { instanceId, updates: [{ productId, title, description }] } → writes to Wix
 */
import type { APIRoute } from 'astro';
import {
  getCachedProductsByIds,
  getAppConfig,
  updateCachedProductFields,
} from '../../backend/dataService';
import { enhanceProducts, applyEnhancementsToWix } from '../../backend/aiEnhancer';
import type { WixProduct } from '../../types/wix.types';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();

    // Mode 1: Preview — generate enhancements and return before/after
    if (body.productIds && !body.updates) {
      const productIds: string[] = body.productIds;
      const config = await getAppConfig(instanceId);
      const cached = await getCachedProductsByIds(instanceId, productIds);
      const products = cached.map((cp) => cp.productData as WixProduct);

      const enhancedMap = await enhanceProducts(products, instanceId, config?.aiEnhancementStyle);

      const previews = cached.map((cp) => {
        const enhanced = enhancedMap.get(cp.productId);
        return {
          productId: cp.productId,
          original: {
            title: cp.name,
            description: cp.plainDescription ?? cp.description ?? '',
          },
          enhanced: enhanced
            ? { title: enhanced.title, description: enhanced.description }
            : null,
        };
      });

      return new Response(JSON.stringify({ success: true, previews }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mode 2: Apply — write accepted enhancements to Wix and update cache
    if (body.updates) {
      const updates: Array<{ productId: string; title: string; description: string }> = body.updates;

      const wixResults = await applyEnhancementsToWix(instanceId, updates);

      // Update products_cache for successful writes
      for (const result of wixResults) {
        if (result.success) {
          const update = updates.find((u) => u.productId === result.productId);
          if (update) {
            await updateCachedProductFields(instanceId, result.productId, {
              name: update.title,
              description: update.description,
              plainDescription: update.description,
            });
          }
        }
      }

      const applied = wixResults.filter((r) => r.success).length;
      const failed = wixResults.filter((r) => !r.success).length;

      return new Response(JSON.stringify({
        success: true,
        applied,
        failed,
        results: wixResults,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Provide productIds (preview) or updates (apply)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
