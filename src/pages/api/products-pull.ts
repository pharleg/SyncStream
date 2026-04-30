import type { APIRoute } from 'astro';
import { pullProducts } from '../../backend/productCache';
import { getProductsCacheTimestamp } from '../../backend/dataService';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    await request.json();

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
