/**
 * dataService.ts
 *
 * CRUD helpers for AppConfig and SyncState Wix Data collections.
 * All Wix Data access is centralized here.
 */

import type { AppConfig, SyncState } from '../types/wix.types';

const COLLECTION_APP_CONFIG = 'AppConfig';
const COLLECTION_SYNC_STATE = 'SyncState';

export async function getAppConfig(
  instanceId: string,
): Promise<AppConfig | null> {
  // TODO: implement with Wix Data SDK
  // wixData.query(COLLECTION_APP_CONFIG).eq('instanceId', instanceId).find()
  throw new Error('Not implemented');
}

export async function saveAppConfig(
  config: AppConfig,
): Promise<void> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}

export async function getSyncState(
  productId: string,
  platform: 'gmc' | 'meta',
): Promise<SyncState | null> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}

export async function upsertSyncState(
  state: SyncState,
): Promise<void> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}

export async function bulkUpsertSyncStates(
  states: SyncState[],
): Promise<void> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}
