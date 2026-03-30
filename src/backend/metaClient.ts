/**
 * metaClient.ts
 *
 * All Meta Graph API Catalog calls live here.
 * No direct fetch calls to Meta should exist elsewhere.
 */

import type { MetaProduct, MetaCatalogResponse } from '../types/meta.types';

export async function upsertProduct(
  _catalogId: string,
  _product: MetaProduct,
  _accessToken: string,
): Promise<MetaCatalogResponse> {
  // TODO Phase 4: implement Meta upsert
  throw new Error('Not implemented');
}

export async function deleteProduct(
  _catalogId: string,
  _retailerId: string,
  _accessToken: string,
): Promise<void> {
  // TODO Phase 4: implement Meta delete
  throw new Error('Not implemented');
}
