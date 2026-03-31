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
import type { SyncRule, SyncFilter, EnhancedContent } from '../types/rules.types';
import type { Platform } from '../types/sync.types';

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
    aiEnhancementEnabled: data.ai_enhancement_enabled ?? false,
    aiEnhancementStyle: data.ai_enhancement_style ?? undefined,
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
        ai_enhancement_enabled: config.aiEnhancementEnabled ?? false,
        ai_enhancement_style: config.aiEnhancementStyle ?? null,
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

// ---------------------------------------------------------------------------
// Rules CRUD
// ---------------------------------------------------------------------------

export async function getRules(instanceId: string, platform: Platform): Promise<SyncRule[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_rules')
    .select('*')
    .eq('instance_id', instanceId)
    .in('platform', [platform, 'both'])
    .eq('enabled', true)
    .order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch rules: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id, instanceId: row.instance_id, name: row.name,
    platform: row.platform, field: row.field, type: row.type,
    expression: row.expression, order: row.order, enabled: row.enabled,
  }));
}

export async function getAllRules(instanceId: string): Promise<SyncRule[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_rules')
    .select('*')
    .eq('instance_id', instanceId)
    .order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch rules: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id, instanceId: row.instance_id, name: row.name,
    platform: row.platform, field: row.field, type: row.type,
    expression: row.expression, order: row.order, enabled: row.enabled,
  }));
}

export async function saveRule(rule: Omit<SyncRule, 'id'> & { id?: string }): Promise<string> {
  const db = await getClient();
  const row = {
    ...(rule.id ? { id: rule.id } : {}),
    instance_id: rule.instanceId, name: rule.name, platform: rule.platform,
    field: rule.field, type: rule.type, expression: rule.expression,
    order: rule.order, enabled: rule.enabled, updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from('sync_rules').upsert(row, { onConflict: 'id' }).select('id').single();
  if (error) throw new Error(`Failed to save rule: ${error.message}`);
  return data.id;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const db = await getClient();
  const { error } = await db.from('sync_rules').delete().eq('id', ruleId);
  if (error) throw new Error(`Failed to delete rule: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Filters CRUD
// ---------------------------------------------------------------------------

export async function getFilters(instanceId: string, platform: Platform): Promise<SyncFilter[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_filters')
    .select('*')
    .eq('instance_id', instanceId)
    .in('platform', [platform, 'both'])
    .eq('enabled', true)
    .order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch filters: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id, instanceId: row.instance_id, name: row.name,
    platform: row.platform, field: row.field, operator: row.operator,
    value: row.value, conditionGroup: row.condition_group,
    order: row.order, enabled: row.enabled,
  }));
}

export async function getAllFilters(instanceId: string): Promise<SyncFilter[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_filters')
    .select('*')
    .eq('instance_id', instanceId)
    .order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch filters: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id, instanceId: row.instance_id, name: row.name,
    platform: row.platform, field: row.field, operator: row.operator,
    value: row.value, conditionGroup: row.condition_group,
    order: row.order, enabled: row.enabled,
  }));
}

export async function saveFilter(filter: Omit<SyncFilter, 'id'> & { id?: string }): Promise<string> {
  const db = await getClient();
  const row = {
    ...(filter.id ? { id: filter.id } : {}),
    instance_id: filter.instanceId, name: filter.name, platform: filter.platform,
    field: filter.field, operator: filter.operator, value: filter.value,
    condition_group: filter.conditionGroup, order: filter.order, enabled: filter.enabled,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from('sync_filters').upsert(row, { onConflict: 'id' }).select('id').single();
  if (error) throw new Error(`Failed to save filter: ${error.message}`);
  return data.id;
}

export async function deleteFilter(filterId: string): Promise<void> {
  const db = await getClient();
  const { error } = await db.from('sync_filters').delete().eq('id', filterId);
  if (error) throw new Error(`Failed to delete filter: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Enhanced Content CRUD
// ---------------------------------------------------------------------------

export async function getEnhancedContent(instanceId: string, productId: string, platform: Platform | 'both' = 'both'): Promise<EnhancedContent | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('enhanced_content')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('product_id', productId)
    .in('platform', [platform, 'both'])
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    id: data.id, instanceId: data.instance_id, productId: data.product_id,
    platform: data.platform, enhancedTitle: data.enhanced_title ?? undefined,
    enhancedDescription: data.enhanced_description, sourceHash: data.source_hash,
    generatedAt: data.generated_at,
  };
}

export async function getBulkEnhancedContent(instanceId: string, productIds: string[]): Promise<Map<string, EnhancedContent>> {
  const db = await getClient();
  const { data, error } = await db
    .from('enhanced_content')
    .select('*')
    .eq('instance_id', instanceId)
    .in('product_id', productIds);
  if (error) throw new Error(`Failed to fetch enhanced content: ${error.message}`);
  const map = new Map<string, EnhancedContent>();
  for (const row of data ?? []) {
    map.set(row.product_id, {
      id: row.id, instanceId: row.instance_id, productId: row.product_id,
      platform: row.platform, enhancedTitle: row.enhanced_title ?? undefined,
      enhancedDescription: row.enhanced_description, sourceHash: row.source_hash,
      generatedAt: row.generated_at,
    });
  }
  return map;
}

export async function saveEnhancedContent(content: Omit<EnhancedContent, 'id'>): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('enhanced_content')
    .upsert({
      instance_id: content.instanceId, product_id: content.productId,
      platform: content.platform, enhanced_title: content.enhancedTitle ?? null,
      enhanced_description: content.enhancedDescription,
      source_hash: content.sourceHash, generated_at: content.generatedAt,
    }, { onConflict: 'instance_id,product_id,platform' });
  if (error) throw new Error(`Failed to save enhanced content: ${error.message}`);
}
