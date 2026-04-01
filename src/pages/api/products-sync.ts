import type { APIRoute } from 'astro';
import { syncFromCache } from '../../backend/syncService';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';
    const productIds: string[] = body.productIds ?? [];
    const platforms = body.platforms ?? ['gmc'];

    if (productIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No product IDs provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await syncFromCache(instanceId, productIds, platforms);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
