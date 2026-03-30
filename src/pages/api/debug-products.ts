/**
 * GET /api/debug-products
 * Returns raw product data from Wix Stores V3 SDK for debugging.
 * Shows the first product's full structure so we can map fields correctly.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  try {
    const { productsV3 } = await import('@wix/stores');

    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 1 } },
      {
        fields: [
          'URL',
          'CURRENCY',
          'PLAIN_DESCRIPTION',
          'MEDIA_ITEMS_INFO',
          'VARIANT_OPTION_CHOICE_NAMES',
        ],
      },
    );

    const firstProduct = response.products?.[0];
    if (!firstProduct) {
      return new Response(JSON.stringify({ error: 'No products found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Also get the full product with getProduct
    const fullProduct = await productsV3.getProduct(
      (firstProduct as any)._id ?? (firstProduct as any).id,
      {
        fields: [
          'URL',
          'CURRENCY',
          'PLAIN_DESCRIPTION',
          'MEDIA_ITEMS_INFO',
          'VARIANT_OPTION_CHOICE_NAMES',
        ],
      },
    );

    return new Response(JSON.stringify({
      queryProduct: firstProduct,
      fullProduct,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
