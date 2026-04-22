/**
 * GET /api/debug-sync
 * Shows all cached products with their computed GMC offerIds.
 * Flags any offerId > 50 chars so the culprit is easy to spot.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, getCachedProducts } from '../../backend/dataService';
import { flattenVariants, mapFlattenedToGmc } from '../../backend/productMapper';
import { validateGmc } from '../../backend/validator';
import type { WixProduct } from '../../types/wix.types';

export const GET: APIRoute = async () => {
  try {
    const [config, cached] = await Promise.all([
      getAppConfig('default'),
      getCachedProducts('default'),
    ]);

    const siteUrl = config?.fieldMappings?.['siteUrl']?.defaultValue ?? '';
    const mappings = config?.fieldMappings ?? {};

    const rows = cached.flatMap((cp) => {
      const product = cp.productData as WixProduct;
      return flattenVariants(product).map((item) => {
        const gmc = mapFlattenedToGmc(item, mappings, siteUrl);
        const errors = validateGmc(gmc, gmc.offerId);
        return {
          productName: product.name,
          productId: item.parentId,
          variantId: item.itemId,
          sku: item.sku ?? null,
          isMultiVariant: item.isMultiVariant,
          offerId: gmc.offerId,
          offerIdLength: gmc.offerId.length,
          tooLong: gmc.offerId.length > 50,
          blockingErrors: errors.filter((e) => e.severity === 'error').map((e) => e.message),
        };
      });
    });

    const tooLong = rows.filter((r) => r.tooLong);

    return new Response(JSON.stringify({
      totalVariants: rows.length,
      tooLongCount: tooLong.length,
      tooLongProducts: tooLong,
      allProducts: rows,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
