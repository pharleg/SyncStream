import type { APIRoute } from 'astro';
import { getCachedProductsByIds, getAppConfig } from '../../backend/dataService';
import { enhanceProducts } from '../../backend/aiEnhancer';
import { BillingError } from '../../backend/billingService';
import type { WixProduct } from '../../types/wix.types';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();
    const productIds: string[] = body.productIds
      ? body.productIds
      : body.productId
        ? [body.productId]
        : [];

    if (productIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No product IDs provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const config = await getAppConfig(instanceId);
    const cached = await getCachedProductsByIds(instanceId, productIds);
    const products = cached.map((cp) => cp.productData as WixProduct);

    const results = await enhanceProducts(products, instanceId, config?.aiEnhancementStyle);

    const enhanced = Array.from(results.entries()).map(([pid, content]) => ({
      productId: pid,
      title: content.title,
      description: content.description,
    }));

    return new Response(JSON.stringify({ success: true, enhanced, count: enhanced.length }), {
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
