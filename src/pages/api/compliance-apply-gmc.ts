/**
 * POST /api/compliance-apply-gmc
 *
 * Stores GMC field overrides for brand, condition, link, imageLink, then
 * triggers a targeted immediate sync for affected products so changes hit
 * GMC right away. Overrides persist and are applied on all future syncs.
 *
 * Body: { productId: string; fixes: Array<{ field: string; value: string }> }
 * Response: { stored: number; synced: number; failed: number }
 */
import type { APIRoute } from 'astro';
import { upsertGmcOverrides } from '../../backend/dataService';
import { syncFromCache } from '../../backend/syncService';

const GMC_OVERRIDE_FIELDS = new Set(['brand', 'condition', 'link', 'imageLink']);

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const productId: string = body.productId;
    const rawFixes: Array<{ field: string; value: string }> = body.fixes ?? [];

    const overrides: Record<string, string> = {};
    for (const fix of rawFixes) {
      if (!GMC_OVERRIDE_FIELDS.has(fix.field)) continue;
      overrides[fix.field] = fix.value;
    }

    if (!productId || Object.keys(overrides).length === 0) {
      return new Response(JSON.stringify({ stored: 0, synced: 0, failed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await upsertGmcOverrides(productId, overrides);

    const stored = 1;

    // Trigger targeted sync for this product
    const syncResult = await syncFromCache('default', [productId], ['gmc']);

    return new Response(JSON.stringify({
      stored,
      synced: syncResult.synced,
      failed: syncResult.failed,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
