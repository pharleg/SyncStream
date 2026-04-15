/**
 * POST /api/compliance-apply-wix
 *
 * Writes compliance fixes for title and description back to Wix products.
 * All other fields (brand, condition, link, imageLink) are silently skipped —
 * those are GMC-only overrides handled by /api/compliance-apply-gmc.
 *
 * Body: { fixes: Array<{ productId: string; field: string; value: string }> }
 * Response: { applied: number; failed: number; results: Array<{ productId, success, error? }> }
 */
import type { APIRoute } from 'astro';
import { applyEnhancementsToWix } from '../../backend/aiEnhancer';
import { updateCachedProductFields } from '../../backend/dataService';

const WIX_FIXABLE_FIELDS = new Set(['title', 'description']);

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const fixes: Array<{ productId: string; field: string; value: string }> = body.fixes ?? [];

    // Group by productId, keep only Wix-writable fields
    const byProduct = new Map<string, { title?: string; description?: string }>();
    for (const fix of fixes) {
      if (!WIX_FIXABLE_FIELDS.has(fix.field)) continue;
      const current = byProduct.get(fix.productId) ?? {};
      if (fix.field === 'title') current.title = fix.value;
      if (fix.field === 'description') current.description = fix.value;
      byProduct.set(fix.productId, current);
    }

    if (byProduct.size === 0) {
      return new Response(JSON.stringify({ applied: 0, failed: 0, results: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates = Array.from(byProduct.entries()).map(([productId, fields]) => ({
      productId,
      title: fields.title ?? '',
      description: fields.description ?? '',
    })).filter((u) => u.title || u.description);

    const wixResults = await applyEnhancementsToWix('default', updates);

    // Update products cache for successful writes
    for (const result of wixResults) {
      if (result.success) {
        const update = updates.find((u) => u.productId === result.productId);
        if (update) {
          const cacheUpdates: Record<string, string> = {};
          if (update.title) { cacheUpdates.name = update.title; }
          if (update.description) {
            cacheUpdates.description = update.description;
            cacheUpdates.plainDescription = update.description;
          }
          await updateCachedProductFields('default', result.productId, cacheUpdates);
        }
      }
    }

    const applied = wixResults.filter((r) => r.success).length;
    const failed = wixResults.filter((r) => !r.success).length;

    return new Response(JSON.stringify({ applied, failed, results: wixResults }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
