/**
 * gmcClient.ts
 *
 * All Google Content API for Shopping v2.1 calls live here.
 * No direct fetch calls to GMC should exist elsewhere.
 */

import type {
  GmcProduct,
  GmcInsertResponse,
  GmcBatchEntry,
  GmcBatchResponse,
  GmcBatchResponseEntry,
} from '../types/gmc.types';

const GMC_BASE_URL =
  'https://shoppingcontent.googleapis.com/content/v2.1';

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
      `GMC API error ${response.status}: ${errorBody}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function insertProduct(
  merchantId: string,
  product: GmcProduct,
  accessToken: string,
): Promise<GmcInsertResponse> {
  return gmcFetch<GmcInsertResponse>(
    `/${merchantId}/products`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(product),
    },
  );
}

export async function deleteProduct(
  merchantId: string,
  offerId: string,
  accessToken: string,
): Promise<void> {
  const restId = `online:en:US:${offerId}`;
  await gmcFetch<void>(
    `/${merchantId}/products/${encodeURIComponent(restId)}`,
    accessToken,
    { method: 'DELETE' },
  );
}

/**
 * Push products in bulk via custombatch.
 * Batches are limited to 10,000 entries per Google's limits,
 * but we cap at 1,000 per call for reliability.
 */
export async function batchInsertProducts(
  merchantId: string,
  products: GmcProduct[],
  accessToken: string,
): Promise<GmcBatchResponseEntry[]> {
  const BATCH_SIZE = 1000;
  const allResults: GmcBatchResponseEntry[] = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const slice = products.slice(i, i + BATCH_SIZE);
    const entries: GmcBatchEntry[] = slice.map(
      (product, idx) => ({
        batchId: i + idx,
        merchantId,
        method: 'insert' as const,
        product,
      }),
    );

    const response = await gmcFetch<GmcBatchResponse>(
      '/products/batch',
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ entries }),
      },
    );

    allResults.push(...response.entries);
  }

  return allResults;
}

export async function refreshAccessToken(
  _refreshToken: string,
): Promise<string> {
  // Moved to oauthService.ts — use getValidGmcAccessToken() instead
  throw new Error(
    'Use oauthService.getValidGmcAccessToken() instead',
  );
}
