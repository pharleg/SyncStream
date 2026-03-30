/**
 * dataService.ts
 *
 * CRUD helpers for AppConfig and SyncState Wix Data collections.
 * All Wix Data access is centralized here.
 *
 * Wix Data SDK API:
 *   items.query(collectionId) → WixDataQuery builder (.eq(), .limit(), .find())
 *   items.insert(collectionId, item) → Promise<Item>
 *   items.update(collectionId, item) → Promise<Item>  (requires _id)
 *   items.save(collectionId, item) → Promise<Item>    (upsert: insert or update)
 */

import { items } from '@wix/data';
import type { AppConfig, SyncState } from '../types/wix.types';

const COLLECTION_APP_CONFIG = 'AppConfig';
const COLLECTION_SYNC_STATE = 'SyncState';

export async function getAppConfig(
  instanceId: string,
): Promise<AppConfig | null> {
  const result = await items
    .query(COLLECTION_APP_CONFIG)
    .eq('instanceId', instanceId)
    .limit(1)
    .find();

  const item = result.items?.[0];
  if (!item) return null;

  return {
    instanceId: item.instanceId as string,
    gmcConnected: (item.gmcConnected as boolean) ?? false,
    metaConnected: (item.metaConnected as boolean) ?? false,
    fieldMappings: item.fieldMappings
      ? JSON.parse(item.fieldMappings as string)
      : {},
    syncEnabled: (item.syncEnabled as boolean) ?? false,
    lastFullSync: item.lastFullSync
      ? new Date(item.lastFullSync as string)
      : null,
  };
}

export async function saveAppConfig(
  config: AppConfig,
): Promise<void> {
  const existing = await items
    .query(COLLECTION_APP_CONFIG)
    .eq('instanceId', config.instanceId)
    .limit(1)
    .find();

  const data = {
    instanceId: config.instanceId,
    gmcConnected: config.gmcConnected,
    metaConnected: config.metaConnected,
    fieldMappings: JSON.stringify(config.fieldMappings),
    syncEnabled: config.syncEnabled,
    lastFullSync: config.lastFullSync?.toISOString() ?? null,
  };

  if (existing.items?.[0]) {
    await items.update(COLLECTION_APP_CONFIG, {
      ...data,
      _id: existing.items[0]._id,
    });
  } else {
    await items.insert(COLLECTION_APP_CONFIG, data);
  }
}

export async function getSyncState(
  productId: string,
  platform: 'gmc' | 'meta',
): Promise<SyncState | null> {
  const result = await items
    .query(COLLECTION_SYNC_STATE)
    .eq('productId', productId)
    .eq('platform', platform)
    .limit(1)
    .find();

  const item = result.items?.[0];
  if (!item) return null;

  return {
    productId: item.productId as string,
    platform: item.platform as 'gmc' | 'meta',
    status: item.status as SyncState['status'],
    lastSynced: new Date(item.lastSynced as string),
    errorLog: item.errorLog ? JSON.parse(item.errorLog as string) : null,
    externalId: (item.externalId as string) ?? '',
  };
}

export async function upsertSyncState(
  state: SyncState,
): Promise<void> {
  const existing = await items
    .query(COLLECTION_SYNC_STATE)
    .eq('productId', state.productId)
    .eq('platform', state.platform)
    .limit(1)
    .find();

  const data = {
    productId: state.productId,
    platform: state.platform,
    status: state.status,
    lastSynced: state.lastSynced.toISOString(),
    errorLog: state.errorLog ? JSON.stringify(state.errorLog) : null,
    externalId: state.externalId,
  };

  if (existing.items?.[0]) {
    await items.update(COLLECTION_SYNC_STATE, {
      ...data,
      _id: existing.items[0]._id,
    });
  } else {
    await items.insert(COLLECTION_SYNC_STATE, data);
  }
}

export async function bulkUpsertSyncStates(
  states: SyncState[],
): Promise<void> {
  const CHUNK_SIZE = 50;
  for (let i = 0; i < states.length; i += CHUNK_SIZE) {
    const chunk = states.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map((s) => upsertSyncState(s)));
  }
}
