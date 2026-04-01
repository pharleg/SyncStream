import type { APIRoute } from 'astro';
import { getCachedProducts, getProductsCacheTimestamp, querySyncStates, getBulkEnhancedContent } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? 'default';

    const [products, cacheTimestamp, syncStates] = await Promise.all([
      getCachedProducts(instanceId),
      getProductsCacheTimestamp(instanceId),
      querySyncStates(500),
    ]);

    const syncMap = new Map<string, { status: string; lastSynced: string }>();
    for (const s of syncStates) {
      syncMap.set(s.productId, { status: s.status, lastSynced: s.lastSynced.toISOString() });
    }

    const productIds = products.map((p) => p.productId);
    const enhancedMap = productIds.length > 0
      ? await getBulkEnhancedContent(instanceId, productIds)
      : new Map();

    const enriched = products.map((p) => ({
      ...p,
      syncStatus: syncMap.get(p.productId) ?? null,
      enhancedDescription: enhancedMap.get(p.productId)?.enhancedDescription ?? null,
      enhancedTitle: enhancedMap.get(p.productId)?.enhancedTitle ?? null,
    }));

    return new Response(JSON.stringify({
      products: enriched,
      cachedAt: cacheTimestamp,
      count: enriched.length,
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
