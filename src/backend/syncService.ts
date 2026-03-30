/**
 * syncService.ts
 *
 * Central orchestrator for product sync operations.
 * Calls productMapper, validator, gmcClient, and metaClient.
 * Nothing else should call those modules directly.
 */

import type { BatchSyncResult, SyncOptions } from '../types/sync.types';

export async function runFullSync(
  _instanceId: string,
  _options: SyncOptions,
): Promise<BatchSyncResult> {
  // TODO Phase 2: implement full sync
  throw new Error('Not implemented');
}

export async function syncProduct(
  _instanceId: string,
  _productId: string,
  _platforms: SyncOptions['platforms'],
): Promise<BatchSyncResult> {
  // TODO Phase 2: implement single-product sync
  throw new Error('Not implemented');
}
