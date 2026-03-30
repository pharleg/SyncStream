/**
 * dataService.ts
 *
 * CRUD helpers for AppConfig and SyncState Wix Data collections.
 * All Wix Data access is centralized here.
 */

import { items } from '@wix/data';
import type { AppConfig, SyncState } from '../types/wix.types';

const COLLECTION_APP_CONFIG = 'AppConfig';
const COLLECTION_SYNC_STATE = 'SyncState';

export async function getAppConfig(
  instanceId: string,
): Promise<AppConfig | null> {
  const result = await items
    .queryDataItems({ dataCollectionId: COLLECTION_APP_CONFIG })
    .eq('instanceId', instanceId)
    .limit(1)
    .find();

  const item = result.items?.[0]?.data;
  if (!item) return null;

  return {
    instanceId: item.instanceId,
    gmcConnected: item.gmcConnected ?? false,
    metaConnected: item.metaConnected ?? false,
    fieldMappings: item.fieldMappings
      ? JSON.parse(item.fieldMappings)
      : {},
    syncEnabled: item.syncEnabled ?? false,
    lastFullSync: item.lastFullSync
      ? new Date(item.lastFullSync)
      : null,
  } as AppConfig;
}

export async function saveAppConfig(
  config: AppConfig,
): Promise<void> {
  const existing = await items
    .queryDataItems({ dataCollectionId: COLLECTION_APP_CONFIG })
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
    await items.updateDataItem({
      dataCollectionId: COLLECTION_APP_CONFIG,
      dataItem: {
        _id: existing.items[0]._id,
        data,
      },
    });
  } else {
    await items.insertDataItem({
      dataCollectionId: COLLECTION_APP_CONFIG,
      dataItem: { data },
    });
  }
}

export async function getSyncState(
  productId: string,
  platform: 'gmc' | 'meta',
): Promise<SyncState | null> {
  const result = await items
    .queryDataItems({ dataCollectionId: COLLECTION_SYNC_STATE })
    .eq('productId', productId)
    .eq('platform', platform)
    .limit(1)
    .find();

  const item = result.items?.[0]?.data;
  if (!item) return null;

  return {
    productId: item.productId,
    platform: item.platform,
    status: item.status,
    lastSynced: new Date(item.lastSynced),
    errorLog: item.errorLog ? JSON.parse(item.errorLog) : null,
    externalId: item.externalId ?? '',
  } as SyncState;
}

export async function upsertSyncState(
  state: SyncState,
): Promise<void> {
  const existing = await items
    .queryDataItems({ dataCollectionId: COLLECTION_SYNC_STATE })
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
    await items.updateDataItem({
      dataCollectionId: COLLECTION_SYNC_STATE,
      dataItem: {
        _id: existing.items[0]._id,
        data,
      },
    });
  } else {
    await items.insertDataItem({
      dataCollectionId: COLLECTION_SYNC_STATE,
      dataItem: { data },
    });
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
