/**
 * syncService.ts
 *
 * Central orchestrator for product sync operations.
 * Calls productMapper, validator, gmcClient, and metaClient.
 * Nothing else should call those modules directly.
 */

import type {
  BatchSyncResult,
  SyncOptions,
  SyncResult,
} from '../types/sync.types';
import type { WixProduct, SyncState } from '../types/wix.types';
import type { GmcProductInput, GmcInsertResult } from '../types/gmc.types';
import { mapToGmc } from './productMapper';
import { validateGmc } from './validator';
import { batchInsertProducts } from './gmcClient';
import {
  getValidGmcAccessToken,
  getGmcTokens,
} from './oauthService';
import {
  getAppConfig,
  bulkUpsertSyncStates,
} from './dataService';

/**
 * Fetch all products from the Wix store.
 * Uses the Wix SDK catalogV3 API with cursor pagination.
 * Each product requires a second getProduct call for variant data.
 */
async function fetchAllProducts(): Promise<WixProduct[]> {
  const { productsV3 } = await import('@wix/stores');
  const products: WixProduct[] = [];
  let cursor: string | undefined;

  do {
    const response = await productsV3.queryProducts(
      {
        cursorPaging: { limit: 100, cursor },
      },
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

    // Use query results directly for products with 0-1 variants.
    // Only call getProduct for multi-variant products that need variant detail.
    for (const p of response.products ?? []) {
      const product = p as any;
      const variantCount = product.variantSummary?.variantCount ?? 1;

      if (variantCount > 1) {
        // Multi-variant: need getProduct for variantsInfo
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
          // Fall back to query result if getProduct fails
          products.push(product as unknown as WixProduct);
        }
      } else {
        // Single variant: query result has everything we need
        products.push(product as unknown as WixProduct);
      }
    }

    cursor =
      (response.pagingMetadata as any)?.cursors?.next ?? undefined;
  } while (cursor);

  return products;
}

async function fetchProductsByIds(
  productIds: string[],
): Promise<WixProduct[]> {
  const { productsV3 } = await import('@wix/stores');
  const products: WixProduct[] = [];

  for (const id of productIds) {
    const product = await productsV3.getProduct(id, {
      fields: [
        'URL',
        'CURRENCY',
        'PLAIN_DESCRIPTION',
        'MEDIA_ITEMS_INFO',
        'VARIANT_OPTION_CHOICE_NAMES',
      ],
    });
    if (product) {
      products.push(product as unknown as WixProduct);
    }
  }

  return products;
}

export async function runFullSync(
  instanceId: string,
  options: SyncOptions,
): Promise<BatchSyncResult> {
  const config = await getAppConfig(instanceId);
  if (!config) {
    throw new Error('App not configured. Please complete setup first.');
  }

  const allProducts = options.productIds
    ? await fetchProductsByIds(options.productIds)
    : await fetchAllProducts();

  // Cloudflare Workers has a 50 subrequest limit.
  // Process max 10 products per invocation to stay within limits.
  const MAX_PRODUCTS_PER_SYNC = 5;
  const products = allProducts.slice(0, MAX_PRODUCTS_PER_SYNC);

  const results: SyncResult[] = [];

  if (options.platforms.includes('gmc')) {
    if (!config.gmcConnected) {
      throw new Error(
        'GMC not connected. Please connect your account first.',
      );
    }

    const accessToken = await getValidGmcAccessToken(instanceId);
    const tokens = await getGmcTokens(instanceId);

    // Map and validate all products
    const validProducts: GmcProductInput[] = [];
    const validationFailures: SyncResult[] = [];

    for (const product of products) {
      const gmcProducts = mapToGmc(
        product,
        config.fieldMappings,
        config.fieldMappings['siteUrl']?.defaultValue ?? '',
      );

      for (const gmcProduct of gmcProducts) {
        const errors = validateGmc(gmcProduct, gmcProduct.offerId);

        if (errors.length > 0) {
          validationFailures.push({
            productId: gmcProduct.offerId,
            platform: 'gmc',
            success: false,
            errors,
          });
        } else {
          validProducts.push(gmcProduct);
        }
      }
    }

    results.push(...validationFailures);

    // Push valid products via custombatch
    if (validProducts.length > 0) {
      const batchResults = await batchInsertProducts(
        tokens.merchantId,
        config.gmcDataSourceId ?? '',
        validProducts,
        accessToken,
      );

      for (const result of batchResults) {
        if (result.success) {
          results.push({
            productId: result.offerId,
            platform: 'gmc',
            success: true,
            externalId: result.name,
          });
        } else {
          results.push({
            productId: result.offerId,
            platform: 'gmc',
            success: false,
            errors: [{
              field: 'api',
              platform: 'gmc' as const,
              message: result.error ?? 'Unknown error',
              productId: result.offerId,
            }],
          });
        }
      }
    }
  }

  // Write SyncState records
  const syncStates: SyncState[] = results.map((r) => ({
    productId: r.productId,
    platform: r.platform,
    status: r.success ? 'synced' as const : 'error' as const,
    lastSynced: new Date(),
    errorLog: r.errors ?? null,
    externalId: r.externalId ?? '',
  }));

  await bulkUpsertSyncStates(syncStates);

  const synced = results.filter((r) => r.success).length;
  return {
    total: results.length,
    synced,
    failed: results.length - synced,
    results,
  };
}

export async function syncProduct(
  instanceId: string,
  productId: string,
  platforms: SyncOptions['platforms'],
): Promise<BatchSyncResult> {
  return runFullSync(instanceId, {
    platforms,
    productIds: [productId],
  });
}
