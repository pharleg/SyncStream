/**
 * gmcClient.ts
 *
 * All Google Content API for Shopping v2.1 calls live here.
 * No direct fetch calls to GMC should exist elsewhere.
 */

import type { GmcProduct, GmcInsertResponse } from '../types/gmc.types';

export async function insertProduct(
  _merchantId: string,
  _product: GmcProduct,
  _accessToken: string,
): Promise<GmcInsertResponse> {
  // TODO Phase 2: implement GMC insert
  throw new Error('Not implemented');
}

export async function deleteProduct(
  _merchantId: string,
  _offerId: string,
  _accessToken: string,
): Promise<void> {
  // TODO Phase 3: implement GMC delete
  throw new Error('Not implemented');
}

export async function refreshAccessToken(
  _refreshToken: string,
): Promise<string> {
  // TODO Phase 2: implement token refresh
  throw new Error('Not implemented');
}
