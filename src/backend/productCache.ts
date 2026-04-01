/**
 * productCache.ts
 *
 * Fetches products from the Wix SDK and caches them in Supabase.
 * The workbench reads from this cache instead of hitting Wix live.
 */

import type { WixProduct } from '../types/wix.types';
import { upsertCachedProducts, type CachedProduct } from './dataService';

/** Convert a Wix image URI to an HTTPS URL. */
function wixImageToUrl(wixImage: string | undefined): string {
  if (!wixImage) return '';
  if (wixImage.startsWith('http')) return wixImage;
  const match = wixImage.match(/wix:image:\/\/v1\/([^/]+)/);
  if (match) return `https://static.wixstatic.com/media/${match[1]}`;
  return '';
}

/** Extract a display price string from a WixProduct. */
function extractDisplayPrice(product: WixProduct): string {
  const amount =
    product.actualPriceRange?.minValue?.amount ??
    product.priceData?.price ??
    product.price?.price;
  if (amount == null) return '';
  return String(amount);
}

/** Map a WixProduct to a CachedProduct row (without id and cachedAt). */
function mapToCacheRow(product: WixProduct, instanceId: string): Omit<CachedProduct, 'id' | 'cachedAt'> {
  const mainImage =
    (product.media?.main as any)?.image ??
    product.media?.main?.image?.url;

  return {
    instanceId,
    productId: product._id ?? product.id,
    name: product.name,
    imageUrl: wixImageToUrl(mainImage),
    price: extractDisplayPrice(product),
    currency: product.currency ?? 'USD',
    availability: product.inventory?.availabilityStatus ?? 'IN_STOCK',
    variantCount: product.variantSummary?.variantCount ?? 1,
    description: product.description ?? undefined,
    plainDescription: product.plainDescription ?? undefined,
    brand: product.brand?.name ?? undefined,
    slug: product.slug,
    productData: product,
  };
}

/**
 * Pull all products from the Wix store and cache them in Supabase.
 * Returns the number of products cached.
 */
export async function pullProducts(instanceId: string): Promise<number> {
  const { productsV3 } = await import('@wix/stores');
  const products: WixProduct[] = [];
  let cursor: string | undefined;

  do {
    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 100, cursor } },
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

    for (const p of response.products ?? []) {
      const product = p as any;
      const variantCount = product.variantSummary?.variantCount ?? 1;

      if (variantCount > 1) {
        try {
          const fullProduct = await productsV3.getProduct(
            product._id ?? product.id,
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
          if (fullProduct) {
            products.push(fullProduct as unknown as WixProduct);
          }
        } catch {
          products.push(product as unknown as WixProduct);
        }
      } else {
        products.push(product as unknown as WixProduct);
      }
    }

    cursor = (response.pagingMetadata as any)?.cursors?.next ?? undefined;
  } while (cursor);

  const rows = products.map((p) => mapToCacheRow(p, instanceId));
  return upsertCachedProducts(instanceId, rows);
}
