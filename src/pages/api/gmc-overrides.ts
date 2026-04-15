/**
 * GET  /api/gmc-overrides?productIds=id1,id2,id3
 *   → { counts: { [productId]: number }, details: { [productId]: { [field]: value } } }
 *
 * DELETE /api/gmc-overrides
 *   Body: { productId: string; field: string }
 *   → { success: true }
 */
import type { APIRoute } from 'astro';
import { getBatchOverrideCounts, getBatchGmcOverrides, clearGmcOverride } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const rawIds = url.searchParams.get('productIds') ?? '';
    const productIds = rawIds ? rawIds.split(',').filter(Boolean) : [];

    if (productIds.length === 0) {
      return new Response(JSON.stringify({ counts: {}, details: {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [countMap, detailMap] = await Promise.all([
      getBatchOverrideCounts(productIds),
      getBatchGmcOverrides(productIds),
    ]);

    const counts: Record<string, number> = {};
    for (const [id, count] of countMap) counts[id] = count;

    const details: Record<string, Record<string, string>> = {};
    for (const [id, fieldMap] of detailMap) {
      details[id] = Object.fromEntries(fieldMap);
    }

    return new Response(JSON.stringify({ counts, details }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { productId, field } = body;
    if (!productId || !field) {
      return new Response(JSON.stringify({ error: 'productId and field required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    await clearGmcOverride(productId, field);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
