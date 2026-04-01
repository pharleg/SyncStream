import type { APIRoute } from 'astro';
import { pullProducts } from '../../backend/productCache';
import { getProductsCacheTimestamp } from '../../backend/dataService';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';

    const count = await pullProducts(instanceId);
    const cachedAt = await getProductsCacheTimestamp(instanceId);

    return new Response(JSON.stringify({ success: true, count, cachedAt }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
