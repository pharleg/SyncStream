import type { APIRoute } from 'astro';
import { syncFromCache } from '../../backend/syncService';
import { BillingError } from '../../backend/billingService';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();
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
    if (error instanceof BillingError) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
