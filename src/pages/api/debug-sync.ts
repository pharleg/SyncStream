/**
 * GET /api/debug-sync
 * Returns the first product's mapped GMC output + config fieldMappings for debugging.
 */
import type { APIRoute } from 'astro';
import { getAppConfig } from '../../backend/dataService';
import { mapToGmc } from '../../backend/productMapper';
import { validateGmc } from '../../backend/validator';
import type { WixProduct } from '../../types/wix.types';

export const GET: APIRoute = async () => {
  try {
    const config = await getAppConfig('default');

    const { productsV3 } = await import('@wix/stores');
    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 1 } },
      { fields: ['URL', 'CURRENCY', 'PLAIN_DESCRIPTION', 'MEDIA_ITEMS_INFO'] },
    );
    const firstQueryProduct = response.products?.[0];
    if (!firstQueryProduct) {
      return new Response(JSON.stringify({ error: 'No products' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fullProduct = await productsV3.getProduct(
      (firstQueryProduct as any)._id ?? (firstQueryProduct as any).id,
      { fields: ['URL', 'CURRENCY', 'PLAIN_DESCRIPTION', 'MEDIA_ITEMS_INFO', 'VARIANT_OPTION_CHOICE_NAMES'] },
    );

    const product = fullProduct as unknown as WixProduct;
    const siteUrl = config?.fieldMappings?.['siteUrl']?.defaultValue ?? '';
    const gmcProducts = mapToGmc(product, config?.fieldMappings ?? {}, siteUrl);
    const firstGmc = gmcProducts[0];
    const errors = firstGmc ? validateGmc(firstGmc, firstGmc.offerId) : [];

    return new Response(JSON.stringify({
      fieldMappings: config?.fieldMappings,
      fieldMappingsType: typeof config?.fieldMappings,
      brandMapping: config?.fieldMappings?.brand,
      productName: product.name,
      productBrand: product.brand,
      gmcProduct: firstGmc,
      validationErrors: errors,
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
