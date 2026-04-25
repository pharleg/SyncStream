/**
 * syncService.ts
 *
 * Central orchestrator for product sync operations.
 * Pipeline: fetch → filter → flatten → enhance → map → rules → validate → push → write state
 */

import type {
  BatchSyncResult,
  SyncOptions,
  SyncResult,
  PaginatedSyncResult,
  SyncProgress,
} from '../types/sync.types';
import type { WixProduct, SyncState, ValidationError } from '../types/wix.types';
import type { GmcProductInput } from '../types/gmc.types';
import { flattenVariants, mapFlattenedToGmc } from './productMapper';
import { validateGmc } from './validator';
import { batchInsertProducts } from './gmcClient';
import { applyFilters } from './filterEngine';
import { applyRules } from './rulesEngine';
import {
  getValidGmcTokens,
} from './oauthService';
import { checkSyncLimit, checkPlatformAccess } from './billingService';
export { BillingError } from './billingService';
import {
  bulkUpsertSyncStates,
  getCachedProducts,
  getCachedProductsByIds,
  upsertSyncProgress,
  getSyncContext,
  upsertSyncEvent,
} from './dataService';

/** Run async tasks with a concurrency limit. */
async function withConcurrency<T>(
  limit: number,
  tasks: (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Fetch all products from the Wix store.
 * Uses the Wix SDK catalogV3 API with cursor pagination.
 * Phase 1: query all products, collect multi-variant IDs.
 * Phase 2: batch-fetch multi-variant details with concurrency(5).
 */
async function fetchAllProducts(): Promise<WixProduct[]> {
  const { productsV3 } = await import('@wix/stores');
  const singleVariantProducts: WixProduct[] = [];
  const multiVariantIds: string[] = [];
  let cursor: string | undefined;

  // Phase 1: Query all products, collect multi-variant IDs
  do {
    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 100, cursor } },
      {
        fields: [
          'URL', 'CURRENCY', 'PLAIN_DESCRIPTION',
          'MEDIA_ITEMS_INFO', 'VARIANT_OPTION_CHOICE_NAMES',
        ],
      },
    );

    for (const p of response.products ?? []) {
      const product = p as any;
      const variantCount = product.variantSummary?.variantCount ?? 1;
      if (variantCount > 1) {
        multiVariantIds.push(product._id ?? product.id);
      } else {
        singleVariantProducts.push(product as unknown as WixProduct);
      }
    }

    cursor = (response.pagingMetadata as any)?.cursors?.next ?? undefined;
  } while (cursor);

  // Phase 2: Batch-fetch multi-variant products with concurrency(5)
  const fetchTasks = multiVariantIds.map((id) => async () => {
    const fullProduct = await productsV3.getProduct(id, {
      fields: [
        'URL', 'CURRENCY', 'PLAIN_DESCRIPTION',
        'MEDIA_ITEMS_INFO', 'VARIANT_OPTION_CHOICE_NAMES',
      ],
    });
    return fullProduct as unknown as WixProduct;
  });

  const settled = await withConcurrency(5, fetchTasks);
  const multiVariantProducts = settled
    .filter((r): r is PromiseFulfilledResult<WixProduct> => r.status === 'fulfilled')
    .map((r) => r.value);

  return [...singleVariantProducts, ...multiVariantProducts];
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

const MAX_PRODUCTS_PER_SYNC = 15;

/**
 * Sync a chunk of pre-fetched products through the full pipeline.
 * Shared by runFullSync and runPaginatedSync.
 */
async function syncProductChunk(
  instanceId: string,
  products: WixProduct[],
  platforms: SyncOptions['platforms'],
): Promise<BatchSyncResult> {
  // Billing gate: enforce Free plan product limit before doing any work
  await checkSyncLimit(instanceId, products.length);

  const allProductIds = products.map((p) => p._id ?? p.id);

  // Single RPC call replaces: getAppConfig + getFilters + getRules +
  // getBatchProductPlatforms + getBatchGmcOverrides + getBulkEnhancedContent
  const ctx = await getSyncContext(instanceId, allProductIds, 'gmc');
  const { config, filters, rules, platformMap, overridesMap, enhancedMap: rawEnhancedMap } = ctx;

  if (!config) {
    throw new Error('App not configured. Please complete setup first.');
  }

  const enhancedMap: Map<string, { title: string; description: string }> = new Map(
    [...rawEnhancedMap.entries()].map(([id, e]) => [
      id,
      { title: e.enhancedTitle ?? '', description: e.enhancedDescription },
    ]),
  );

  const results: SyncResult[] = [];

  if (platforms.includes('gmc')) {
    // Billing gate: Free plan can access GMC, Pro required for Meta
    await checkPlatformAccess(instanceId, 'gmc');

    if (!config.gmcConnected) {
      throw new Error('GMC not connected. Please connect your account first.');
    }

    const tokens = await getValidGmcTokens(instanceId);
    const accessToken = tokens.accessToken;
    const siteUrl = config.fieldMappings['siteUrl']?.defaultValue ?? '';

    // 2. Apply filters
    const filtered = applyFilters(products, filters, 'gmc');

    // 2b. Per-product platform targeting — skip products not targeting GMC
    const platformFiltered = filtered.filter((p) => {
      const id = p._id ?? p.id;
      const targets = platformMap.get(id);
      return targets === null || targets === undefined || targets.includes('gmc');
    });

    // 3. Flatten variants
    const flattened = platformFiltered.flatMap((p) => flattenVariants(p));

    // 4-5. Map to GMC format + apply rules + apply overrides + validate
    const validProducts: GmcProductInput[] = [];
    const validationFailures: SyncResult[] = [];
    const productWarnings = new Map<string, ValidationError[]>();
    // offerId → parentId: needed so GMC API results can be stored under the
    // Wix parent product ID (which is how the products table looks up status)
    const offerIdToParentId = new Map<string, string>();

    for (const item of flattened) {
      const parentId = item.parentId;
      const enhanced = enhancedMap.get(parentId);

      const gmcProduct = mapFlattenedToGmc(item, config.fieldMappings, siteUrl, enhanced);
      offerIdToParentId.set(gmcProduct.offerId, parentId);

      // Apply any stored merchant overrides for this product
      const overrides = overridesMap.get(parentId);
      if (overrides && overrides.size > 0) {
        for (const [field, value] of overrides) {
          if (field === 'brand') gmcProduct.productAttributes.brand = value;
          else if (field === 'condition') gmcProduct.productAttributes.condition = value as any;
          else if (field === 'link') gmcProduct.productAttributes.link = value;
          else if (field === 'imageLink') gmcProduct.productAttributes.imageLink = value;
        }
      }

      const transformed = applyRules([gmcProduct], rules, 'gmc');
      const allIssues = validateGmc(transformed[0], transformed[0].offerId);
      const blockingErrors = allIssues.filter((e) => e.severity === 'error');

      if (blockingErrors.length > 0) {
        validationFailures.push({
          productId: parentId,
          platform: 'gmc',
          success: false,
          errors: allIssues,
        });
      } else {
        if (allIssues.length > 0) {
          productWarnings.set(transformed[0].offerId, allIssues);
        }
        validProducts.push(transformed[0]);
      }
    }

    results.push(...validationFailures);

    // 6. Push valid products to GMC
    if (validProducts.length > 0) {
      const batchResults = await batchInsertProducts(
        tokens.merchantId,
        config.gmcDataSourceId ?? '',
        validProducts,
        accessToken,
      );

      for (const result of batchResults) {
        const parentId = offerIdToParentId.get(result.offerId) ?? result.offerId;
        if (result.success) {
          const warnings = productWarnings.get(result.offerId) ?? null;
          results.push({
            productId: parentId,
            platform: 'gmc',
            success: true,
            externalId: result.name,
            errors: warnings ?? undefined,
          });
        } else {
          results.push({
            productId: parentId,
            platform: 'gmc',
            success: false,
            errors: [{
              field: 'api',
              platform: 'gmc' as const,
              message: result.error ?? 'Unknown error',
              productId: parentId,
              severity: 'error' as const,
            }],
          });
        }
      }
    }
  }

  if (platforms.includes('meta')) {
    // Billing gate: Meta sync requires Pro plan
    await checkPlatformAccess(instanceId, 'meta');
    // Meta push not yet implemented — gate is in place for when it is added
  }

  // 7. Write SyncState records (deduplicate by productId+platform — multi-variant
  //    products produce one SyncResult per variant but one SyncState per product)
  const stateMap = new Map<string, SyncState>();
  for (const r of results) {
    const key = `${r.productId}:${r.platform}`;
    const existing = stateMap.get(key);
    if (!existing) {
      stateMap.set(key, {
        productId: r.productId,
        platform: r.platform,
        status: r.success ? 'synced' as const : 'error' as const,
        lastSynced: new Date(),
        errorLog: r.errors ?? null,
        externalId: r.externalId ?? '',
      });
    } else {
      // Any variant failure = product failure; merge error logs
      const mergedStatus = (!r.success || existing.status === 'error') ? 'error' as const : 'synced' as const;
      const parts = [existing.errorLog, r.errors ?? null].filter((e): e is NonNullable<typeof e> => e != null);
      const mergedLog = parts.flatMap((e) => (Array.isArray(e) ? e : [e]));
      stateMap.set(key, {
        ...existing,
        status: mergedStatus,
        errorLog: mergedLog.length > 0 ? mergedLog : null,
      });
    }
  }
  const syncStates: SyncState[] = Array.from(stateMap.values());

  await bulkUpsertSyncStates(syncStates);

  const synced = results.filter((r) => r.success).length;
  return {
    total: results.length,
    synced,
    failed: results.length - synced,
    results,
  };
}

export async function runFullSync(
  instanceId: string,
  options: SyncOptions,
): Promise<BatchSyncResult> {
  const allProducts = options.productIds
    ? await fetchProductsByIds(options.productIds)
    : await fetchAllProducts();

  const products = allProducts.slice(0, MAX_PRODUCTS_PER_SYNC);
  return syncProductChunk(instanceId, products, options.platforms);
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

/**
 * Sync specific products from the products_cache through the full pipeline.
 * Used by the workbench to sync without re-fetching from Wix.
 */
export async function syncFromCache(
  instanceId: string,
  productIds: string[],
  platforms: SyncOptions['platforms'],
): Promise<BatchSyncResult> {
  const cachedProducts = await getCachedProductsByIds(instanceId, productIds);
  if (cachedProducts.length === 0) {
    return { total: 0, synced: 0, failed: 0, results: [] };
  }

  // Reconstruct WixProduct objects from cached product_data JSON
  const products: WixProduct[] = cachedProducts.map((cp) => cp.productData as WixProduct);

  // Billing gate: enforce Free plan product limit before doing any work
  await checkSyncLimit(instanceId, products.length);

  const allProductIds = products.map((p) => p._id ?? p.id);
  const ctx = await getSyncContext(instanceId, allProductIds, 'gmc');
  const { config, filters, rules, overridesMap, enhancedMap: rawEnhancedMap } = ctx;

  if (!config) {
    throw new Error('App not configured. Please complete setup first.');
  }

  const enhancedMap: Map<string, { title: string; description: string }> = new Map(
    [...rawEnhancedMap.entries()].map(([id, e]) => [
      id,
      { title: e.enhancedTitle ?? '', description: e.enhancedDescription },
    ]),
  );

  const results: SyncResult[] = [];

  if (platforms.includes('gmc')) {
    // Billing gate: Free plan can access GMC, Pro required for Meta
    await checkPlatformAccess(instanceId, 'gmc');

    if (!config.gmcConnected) {
      throw new Error('GMC not connected. Please connect your account first.');
    }

    const tokens = await getValidGmcTokens(instanceId);
    const accessToken = tokens.accessToken;
    const siteUrl = config.fieldMappings['siteUrl']?.defaultValue ?? '';

    const filtered = applyFilters(products, filters, 'gmc');
    const flattened = filtered.flatMap((p) => flattenVariants(p));

    const validProducts: GmcProductInput[] = [];
    const validationFailures: SyncResult[] = [];
    const productWarnings = new Map<string, ValidationError[]>();
    const offerIdToParentId = new Map<string, string>();

    for (const item of flattened) {
      const parentId = item.parentId;
      const enhanced = enhancedMap.get(parentId);
      const gmcProduct = mapFlattenedToGmc(item, config.fieldMappings, siteUrl, enhanced);
      offerIdToParentId.set(gmcProduct.offerId, parentId);

      const overrides = overridesMap.get(parentId);
      if (overrides && overrides.size > 0) {
        for (const [field, value] of overrides) {
          if (field === 'brand') gmcProduct.productAttributes.brand = value;
          else if (field === 'condition') gmcProduct.productAttributes.condition = value as any;
          else if (field === 'link') gmcProduct.productAttributes.link = value;
          else if (field === 'imageLink') gmcProduct.productAttributes.imageLink = value;
        }
      }
      const transformed = applyRules([gmcProduct], rules, 'gmc');
      const allIssues = validateGmc(transformed[0], transformed[0].offerId);
      const blockingErrors = allIssues.filter((e) => e.severity === 'error');

      if (blockingErrors.length > 0) {
        validationFailures.push({
          productId: parentId,
          platform: 'gmc',
          success: false,
          errors: allIssues,
        });
      } else {
        if (allIssues.length > 0) {
          productWarnings.set(transformed[0].offerId, allIssues);
        }
        validProducts.push(transformed[0]);
      }
    }

    results.push(...validationFailures);

    if (validProducts.length > 0) {
      const batchResults = await batchInsertProducts(
        tokens.merchantId,
        config.gmcDataSourceId ?? '',
        validProducts,
        accessToken,
      );

      for (const result of batchResults) {
        const parentId = offerIdToParentId.get(result.offerId) ?? result.offerId;
        if (result.success) {
          const warnings = productWarnings.get(result.offerId) ?? null;
          results.push({
            productId: parentId,
            platform: 'gmc',
            success: true,
            externalId: result.name,
            errors: warnings ?? undefined,
          });
        } else {
          results.push({
            productId: parentId,
            platform: 'gmc',
            success: false,
            errors: [{
              field: 'api',
              platform: 'gmc' as const,
              message: result.error ?? 'Unknown error',
              productId: parentId,
              severity: 'error' as const,
            }],
          });
        }
      }
    }
  }

  if (platforms.includes('meta')) {
    // Billing gate: Meta sync requires Pro plan
    await checkPlatformAccess(instanceId, 'meta');
    // Meta push not yet implemented — gate is in place for when it is added
  }

  const stateMap2 = new Map<string, SyncState>();
  for (const r of results) {
    const key = `${r.productId}:${r.platform}`;
    const existing = stateMap2.get(key);
    if (!existing) {
      stateMap2.set(key, {
        productId: r.productId,
        platform: r.platform,
        status: r.success ? 'synced' as const : 'error' as const,
        lastSynced: new Date(),
        errorLog: r.errors ?? null,
        externalId: r.externalId ?? '',
      });
    } else {
      const mergedStatus = (!r.success || existing.status === 'error') ? 'error' as const : 'synced' as const;
      const parts2 = [existing.errorLog, r.errors ?? null].filter((e): e is NonNullable<typeof e> => e != null);
      const mergedLog = parts2.flatMap((e) => (Array.isArray(e) ? e : [e]));
      stateMap2.set(key, {
        ...existing,
        status: mergedStatus,
        errorLog: mergedLog.length > 0 ? mergedLog : null,
      });
    }
  }
  const syncStates: SyncState[] = Array.from(stateMap2.values());

  await bulkUpsertSyncStates(syncStates);

  const synced = results.filter((r) => r.success).length;
  return {
    total: results.length,
    synced,
    failed: results.length - synced,
    results,
  };
}

/**
 * Run a full catalog sync with automatic pagination and progress tracking.
 * Fetches all products ONCE, then processes in chunks of MAX_PRODUCTS_PER_SYNC.
 */
export async function runPaginatedSync(
  instanceId: string,
  platforms: SyncOptions['platforms'],
): Promise<PaginatedSyncResult> {
  const allResults: SyncResult[] = [];

  const progress: SyncProgress = {
    instanceId,
    totalProducts: 0,
    processed: 0,
    currentStatus: 'running',
    syncedCount: 0,
    failedCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const tryProgress = (p: SyncProgress) => upsertSyncProgress(p).catch(() => {});

  try {
    // Use cached products from Supabase — avoids N Wix SDK subrequests per product.
    // Products are cached by "Pull Products". If cache is empty, bail with a clear message.
    const cached = await getCachedProducts(instanceId);
    if (cached.length === 0) {
      throw new Error('No products in cache. Pull products first before syncing.');
    }
    const allProducts: WixProduct[] = cached.map((cp) => cp.productData as WixProduct);
    const totalProducts = allProducts.length;
    progress.totalProducts = totalProducts;

    // Process in chunks
    for (let offset = 0; offset < totalProducts; offset += MAX_PRODUCTS_PER_SYNC) {
      const chunk = allProducts.slice(offset, offset + MAX_PRODUCTS_PER_SYNC);
      const result = await syncProductChunk(instanceId, chunk, platforms);
      allResults.push(...result.results);
    }

    progress.currentStatus = 'completed';
    progress.processed = totalProducts;
    progress.syncedCount = allResults.filter((r) => r.success).length;
    progress.failedCount = allResults.filter((r) => !r.success).length;
    progress.updatedAt = new Date().toISOString();
    await tryProgress(progress);
    // Write activity event (best-effort — don't fail the sync if this fails)
    await upsertSyncEvent({
      instanceId,
      eventType: progress.failedCount > 0 ? 'sync_error' : 'sync_complete',
      message: progress.failedCount > 0
        ? `${progress.syncedCount} synced, ${progress.failedCount} failed out of ${totalProducts} products`
        : `${progress.syncedCount} products synced successfully`,
      severity: progress.failedCount > 0 ? 'error' : 'success',
      productCount: totalProducts,
    }).catch(() => {});
  } catch (error) {
    progress.currentStatus = 'error';
    progress.error = error instanceof Error ? error.message : 'Unknown error';
    await tryProgress(progress);
    await upsertSyncEvent({
      instanceId,
      eventType: 'sync_error',
      message: progress.error,
      severity: 'error',
    }).catch(() => {});
    throw error;
  }

  const synced = allResults.filter((r) => r.success).length;
  return {
    total: allResults.length,
    synced,
    failed: allResults.length - synced,
    results: allResults,
    progress,
  };
}
