/**
 * POST /api/compliance-apply-wix
 *
 * Writes compliance fixes for title and description back to Wix products.
 * All other fields (brand, condition, link, imageLink) are silently skipped —
 * those are GMC-only overrides handled by /api/compliance-apply-gmc.
 *
 * Body: { productId: string; fixes: Array<{ field: string; value: string }> }
 * Response: { applied: number; failed: number; results: Array<{ productId, success, error? }> }
 */
import type { APIRoute } from 'astro';
import { applyEnhancementsToWix } from '../../backend/aiEnhancer';
import { updateCachedProductFields } from '../../backend/dataService';

const WIX_FIXABLE_FIELDS = new Set(['title', 'description']);

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const productId: string = body.productId;
    // Accept both array [{ field, value }] and object { field: value } formats
    let rawFixes: Array<{ field: string; value: string }> = [];
    if (Array.isArray(body.fixes)) {
      rawFixes = body.fixes;
    } else if (body.fixes && typeof body.fixes === 'object') {
      rawFixes = Object.entries(body.fixes as Record<string, string>).map(([field, value]) => ({ field, value: String(value) }));
    }

    const fields: { title?: string; description?: string } = {};
    for (const fix of rawFixes) {
      if (!WIX_FIXABLE_FIELDS.has(fix.field)) continue;
      if (fix.field === 'title') fields.title = fix.value;
      if (fix.field === 'description') fields.description = fix.value;
    }

    if (!productId || (!fields.title && !fields.description)) {
      return new Response(JSON.stringify({ applied: 0, failed: 0, results: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates = [{
      productId,
      title: fields.title ?? '',
      description: fields.description ?? '',
    }].filter((u) => u.title || u.description);

    const wixResults = await applyEnhancementsToWix('default', updates);

    // Update products cache for successful writes
    for (const result of wixResults) {
      if (result.success) {
        const update = updates.find((u) => u.productId === result.productId);
        if (update) {
          const cacheUpdates: { name?: string; description?: string; plainDescription?: string } = {};
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
