/**
 * gmcClient.ts
 *
 * All Google Merchant API v1 calls live here.
 * No direct fetch calls to Google should exist elsewhere.
 *
 * Migration from Content API v2.1:
 * - Base URL: merchantapi.googleapis.com
 * - Write to productInputs, read from products
 * - No custombatch — use concurrent requests
 * - Price in amountMicros format
 * - dataSource query param required on all writes
 */

import type {
  GmcProductInput,
  GmcInsertResponse,
  GmcInsertResult,
} from '../types/gmc.types';

const GMC_BASE_URL = 'https://merchantapi.googleapis.com';

async function gmcFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GMC_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Merchant API error ${response.status}: ${errorBody}`,
    );
  }

  // DELETE returns empty body
  if (response.status === 204 || options.method === 'DELETE') {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Insert a single product via productInputs:insert.
 */
export async function insertProduct(
  merchantId: string,
  dataSourceId: string,
  product: GmcProductInput,
  accessToken: string,
): Promise<GmcInsertResponse> {
  if (product.offerId.length > 50) {
    console.error(
      `[gmcClient] offerId too long (${product.offerId.length} chars): "${product.offerId}" — truncating to 50`,
    );
    product = { ...product, offerId: product.offerId.slice(0, 50) };
  }
  const dataSource = `accounts/${merchantId}/dataSources/${dataSourceId}`;
  return gmcFetch<GmcInsertResponse>(
    `/products/v1/accounts/${merchantId}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(product),
    },
  );
}

/**
 * Delete a product via productInputs DELETE.
 * Resource name format: accounts/{account}/productInputs/{contentLanguage}~{feedLabel}~{offerId}
 */
export async function deleteProduct(
  merchantId: string,
  dataSourceId: string,
  offerId: string,
  contentLanguage: string,
  feedLabel: string,
  accessToken: string,
): Promise<void> {
  const productInputName = `${contentLanguage}~${feedLabel}~${offerId}`;
  const dataSource = `accounts/${merchantId}/dataSources/${dataSourceId}`;
  await gmcFetch<void>(
    `/products/v1/accounts/${merchantId}/productInputs/${encodeURIComponent(productInputName)}?dataSource=${encodeURIComponent(dataSource)}`,
    accessToken,
    { method: 'DELETE' },
  );
}

/**
 * Run async tasks with a concurrency limit.
 * Returns results in the same order as the input tasks.
 */
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
 * Insert multiple products concurrently.
 * Replaces the v2.1 custombatch endpoint which doesn't exist in Merchant API v1.
 * Processes up to 5 concurrent requests to stay within Cloudflare Workers subrequest limits.
 */
export async function batchInsertProducts(
  merchantId: string,
  dataSourceId: string,
  products: GmcProductInput[],
  accessToken: string,
): Promise<GmcInsertResult[]> {
  const tasks = products.map((product) => () =>
    insertProduct(merchantId, dataSourceId, product, accessToken)
      .then((response): GmcInsertResult => ({
        offerId: product.offerId,
        success: true,
        name: response.name,
      }))
      .catch((error): GmcInsertResult => ({
        offerId: product.offerId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })),
  );

  const settled = await withConcurrency(5, tasks);
  return settled.map((r) =>
    r.status === 'fulfilled' ? r.value : { offerId: '', success: false, error: 'Worker failed' },
  );
}

/**
 * Register the GCP project with Merchant API.
 * Must be called once per GCP project before using v1 APIs.
 */
export async function registerGcpProject(
  merchantId: string,
  accessToken: string,
  developerEmail: string = 'curtis.mcewen@purposefulit.com',
): Promise<void> {
  try {
    await gmcFetch<unknown>(
      `/accounts/v1/accounts/${merchantId}/developerRegistration:registerGcp`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ developerEmail }) },
    );
  } catch {
    // May fail if already registered — that's fine
  }
}

/**
 * Create an API data source for product uploads.
 * Returns the data source ID.
 */
export async function createDataSource(
  merchantId: string,
  accessToken: string,
  feedLabel: string = 'US',
  contentLanguage: string = 'en',
): Promise<string> {
  const response = await gmcFetch<{ name: string }>(
    `/datasources/v1/accounts/${merchantId}/dataSources`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'SyncStream API Source',
        primaryProductDataSource: {
          feedLabel,
          contentLanguage,
          countries: [feedLabel],
        },
      }),
    },
  );

  // Extract data source ID from name: "accounts/123/dataSources/456" → "456"
  const parts = response.name.split('/');
  return parts[parts.length - 1];
}
