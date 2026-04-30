import type { APIRoute } from 'astro';
import { getCachedProducts, getCachedProductsByIds } from '../../backend/dataService';
import { runComplianceCheck } from '../../backend/validator';
import type { WixProduct } from '../../types/wix.types';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();
    const platform: 'gmc' | 'meta' = body.platform ?? 'gmc';
    const productIds: string[] | undefined = body.productIds;

    let cachedProducts;
    if (productIds && productIds.length > 0) {
      cachedProducts = await getCachedProductsByIds(instanceId, productIds);
    } else {
      cachedProducts = await getCachedProducts(instanceId);
    }

    if (!cachedProducts || cachedProducts.length === 0) {
      return new Response(JSON.stringify({
        error: 'No products found. Pull products first.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const products: WixProduct[] = cachedProducts.map((cp) => cp.productData as WixProduct);
    const summary = await runComplianceCheck(instanceId, products, platform);

    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compliance check failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
