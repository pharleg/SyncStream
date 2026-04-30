import type { APIRoute } from 'astro';
import { getCachedProductsByIds, getAppConfig, getRules } from '../../backend/dataService';
import { flattenVariants, mapFlattenedToGmc } from '../../backend/productMapper';
import { applyRules } from '../../backend/rulesEngine';
import type { WixProduct } from '../../types/wix.types';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();
    const productIds: string[] = body.productIds ?? [];

    const config = await getAppConfig(instanceId);
    if (!config) {
      return new Response(JSON.stringify({ error: 'App not configured' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cached = await getCachedProductsByIds(instanceId, productIds);
    const rules = await getRules(instanceId, 'gmc');
    const siteUrl = config.fieldMappings['siteUrl']?.defaultValue ?? '';

    const previews = cached.map((cp) => {
      const product = cp.productData as WixProduct;
      const flattened = flattenVariants(product);
      const firstItem = flattened[0];
      const original = mapFlattenedToGmc(firstItem, config.fieldMappings, siteUrl);
      const transformedInput = { ...original, productAttributes: { ...original.productAttributes } };
      const transformed = applyRules([transformedInput], rules, 'gmc');

      return {
        productId: cp.productId,
        original: {
          title: original.productAttributes.title,
          description: original.productAttributes.description,
          price: original.productAttributes.price,
          brand: original.productAttributes.brand,
        },
        transformed: {
          title: transformed[0].productAttributes.title,
          description: transformed[0].productAttributes.description,
          price: transformed[0].productAttributes.price,
          brand: transformed[0].productAttributes.brand,
        },
      };
    });

    return new Response(JSON.stringify({ previews }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
