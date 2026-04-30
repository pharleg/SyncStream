/**
 * POST /api/wizard-generate
 *
 * Generates an AI title + description suggestion for a single product.
 * Body: { productId: string; instanceId?: string }
 * Response: { title: string; description: string }
 */
import type { APIRoute } from 'astro';
import { getCachedProductsByIds, getAppConfig } from '../../backend/dataService';
import { enhanceProduct } from '../../backend/aiEnhancer';
import { BillingError } from '../../backend/billingService';
import type { WixProduct } from '../../types/wix.types';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();
    const productId: string = body.productId;

    if (!productId) {
      return new Response(JSON.stringify({ error: 'productId required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const [cached, config] = await Promise.all([
      getCachedProductsByIds(instanceId, [productId]),
      getAppConfig(instanceId),
    ]);

    if (!cached.length) {
      return new Response(JSON.stringify({ error: 'Product not found in cache' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const product = cached[0].productData as WixProduct | undefined;
    if (!product) {
      return new Response(JSON.stringify({ error: 'Product cache entry has no data' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const enhanced = await enhanceProduct(product, instanceId, config?.aiEnhancementStyle);

    return new Response(
      JSON.stringify({ title: enhanced.title, description: enhanced.description }),
      { headers: { 'Content-Type': 'application/json' } },
    );
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
