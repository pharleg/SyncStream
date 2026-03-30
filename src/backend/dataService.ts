/**
 * dataService.ts
 *
 * CRUD helpers for AppConfig and SyncState.
 * Uses Supabase (Postgres) instead of Wix Data collections.
 * Credentials stored in Wix Secrets Manager:
 *   - supabase_project_url
 *   - supabase_service_role
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secrets } from '@wix/secrets';
import type { AppConfig, SyncState } from '../types/wix.types';

let _client: SupabaseClient | null = null;

async function getClient(): Promise<SupabaseClient> {
  if (_client) return _client;
  const url = (await secrets.getSecretValue('supabase_project_url')).value!;
  const key = (await secrets.getSecretValue('supabase_service_role')).value!;
  _client = createClient(url, key);
  return _client;
}

export async function getAppConfig(
  instanceId: string,
): Promise<AppConfig | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('app_config')
    .select('*')
    .eq('instance_id', instanceId)
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    instanceId: data.instance_id,
    gmcConnected: data.gmc_connected ?? false,
    metaConnected: data.meta_connected ?? false,
    fieldMappings: typeof data.field_mappings === 'string'
      ? JSON.parse(data.field_mappings)
      : data.field_mappings ?? {},
    syncEnabled: data.sync_enabled ?? false,
    lastFullSync: data.last_full_sync ? new Date(data.last_full_sync) : null,
    gmcDataSourceId: data.gmc_data_source_id ?? undefined,
  };
}

export async function saveAppConfig(
  config: AppConfig,
): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('app_config')
    .upsert(
      {
        instance_id: config.instanceId,
        gmc_connected: config.gmcConnected,
        meta_connected: config.metaConnected,
        field_mappings: config.fieldMappings,
        sync_enabled: config.syncEnabled,
        last_full_sync: config.lastFullSync?.toISOString() ?? null,
        gmc_data_source_id: config.gmcDataSourceId ?? null,
      },
      { onConflict: 'instance_id' },
    );

  if (error) throw new Error(`Failed to save AppConfig: ${error.message}`);
}

export async function getSyncState(
  productId: string,
  platform: 'gmc' | 'meta',
): Promise<SyncState | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_state')
    .select('*')
    .eq('product_id', productId)
    .eq('platform', platform)
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    productId: data.product_id,
    platform: data.platform,
    status: data.status,
    lastSynced: new Date(data.last_synced),
    errorLog: data.error_log ?? null,
    externalId: data.external_id ?? '',
  };
}

export async function upsertSyncState(
  state: SyncState,
): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('sync_state')
    .upsert(
      {
        product_id: state.productId,
        platform: state.platform,
        status: state.status,
        last_synced: state.lastSynced.toISOString(),
        error_log: state.errorLog,
        external_id: state.externalId,
      },
      { onConflict: 'product_id,platform' },
    );

  if (error) throw new Error(`Failed to upsert SyncState: ${error.message}`);
}

export async function bulkUpsertSyncStates(
  states: SyncState[],
): Promise<void> {
  if (states.length === 0) return;
  const db = await getClient();
  const { error } = await db
    .from('sync_state')
    .upsert(
      states.map((s) => ({
        product_id: s.productId,
        platform: s.platform,
        status: s.status,
        last_synced: s.lastSynced.toISOString(),
        error_log: s.errorLog,
        external_id: s.externalId,
      })),
      { onConflict: 'product_id,platform' },
    );

  if (error) throw new Error(`Failed to bulk upsert SyncState: ${error.message}`);
}

/** Query sync states for the Status dashboard. */
export async function querySyncStates(
  limit: number = 200,
): Promise<SyncState[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_state')
    .select('*')
    .order('last_synced', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to query SyncState: ${error.message}`);

  return (data ?? []).map((row) => ({
    productId: row.product_id,
    platform: row.platform,
    status: row.status,
    lastSynced: new Date(row.last_synced),
    errorLog: row.error_log ?? null,
    externalId: row.external_id ?? '',
  }));
}
