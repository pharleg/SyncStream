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
import type { Platform, SyncProgress } from '../types/sync.types';

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

// ── Products Cache CRUD ──

export interface CachedProduct {
  id: string;
  instanceId: string;
  productId: string;
  name: string;
  imageUrl?: string;
  price?: string;
  currency: string;
  availability?: string;
  variantCount: number;
  description?: string;
  plainDescription?: string;
  brand?: string;
  slug?: string;
  productData: any;
  cachedAt: string;
}

export async function upsertCachedProducts(
  instanceId: string,
  products: Omit<CachedProduct, 'id' | 'cachedAt'>[],
): Promise<number> {
  if (products.length === 0) return 0;
  const db = await getClient();
  const rows = products.map((p) => ({
    instance_id: instanceId,
    product_id: p.productId,
    name: p.name,
    image_url: p.imageUrl ?? null,
    price: p.price ?? null,
    currency: p.currency,
    availability: p.availability ?? null,
    variant_count: p.variantCount,
    description: p.description ?? null,
    plain_description: p.plainDescription ?? null,
    brand: p.brand ?? null,
    slug: p.slug ?? null,
    product_data: p.productData,
    cached_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from('products_cache')
    .upsert(rows, { onConflict: 'instance_id,product_id' });

  if (error) throw new Error(`Failed to cache products: ${error.message}`);
  return rows.length;
}

export async function getCachedProducts(instanceId: string): Promise<CachedProduct[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('products_cache')
    .select('*')
    .eq('instance_id', instanceId)
    .order('name', { ascending: true });

  if (error) throw new Error(`Failed to fetch cached products: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    productId: row.product_id,
    name: row.name,
    imageUrl: row.image_url ?? undefined,
    price: row.price ?? undefined,
    currency: row.currency,
    availability: row.availability ?? undefined,
    variantCount: row.variant_count,
    description: row.description ?? undefined,
    plainDescription: row.plain_description ?? undefined,
    brand: row.brand ?? undefined,
    slug: row.slug ?? undefined,
    productData: row.product_data,
    cachedAt: row.cached_at,
  }));
}

export async function getCachedProductsByIds(
  instanceId: string,
  productIds: string[],
): Promise<CachedProduct[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('products_cache')
    .select('*')
    .eq('instance_id', instanceId)
    .in('product_id', productIds);

  if (error) throw new Error(`Failed to fetch cached products: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    productId: row.product_id,
    name: row.name,
    imageUrl: row.image_url ?? undefined,
    price: row.price ?? undefined,
    currency: row.currency,
    availability: row.availability ?? undefined,
    variantCount: row.variant_count,
    description: row.description ?? undefined,
    plainDescription: row.plain_description ?? undefined,
    brand: row.brand ?? undefined,
    slug: row.slug ?? undefined,
    productData: row.product_data,
    cachedAt: row.cached_at,
  }));
}

export async function getProductsCacheTimestamp(instanceId: string): Promise<string | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('products_cache')
    .select('cached_at')
    .eq('instance_id', instanceId)
    .order('cached_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.cached_at;
}

export async function updateCachedProductFields(
  instanceId: string,
  productId: string,
  fields: { name?: string; description?: string; plainDescription?: string },
): Promise<void> {
  const db = await getClient();

  const updateData: Record<string, unknown> = { cached_at: new Date().toISOString() };
  if (fields.name !== undefined) updateData.name = fields.name;
  if (fields.description !== undefined) updateData.description = fields.description;
  if (fields.plainDescription !== undefined) updateData.plain_description = fields.plainDescription;

  const { error } = await db
    .from('products_cache')
    .update(updateData)
    .eq('instance_id', instanceId)
    .eq('product_id', productId);

  if (error) throw new Error(`Failed to update cached product: ${error.message}`);
}

// ── Sync Progress CRUD ──

export async function upsertSyncProgress(progress: SyncProgress): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('sync_progress')
    .upsert({
      instance_id: progress.instanceId,
      total_products: progress.totalProducts,
      processed: progress.processed,
      current_status: progress.currentStatus,
      synced_count: progress.syncedCount,
      failed_count: progress.failedCount,
      started_at: progress.startedAt,
      updated_at: new Date().toISOString(),
      error: progress.error ?? null,
    }, { onConflict: 'instance_id' });
  if (error) throw new Error(`Failed to upsert sync progress: ${error.message}`);
}

export async function getSyncProgress(instanceId: string): Promise<SyncProgress | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_progress')
    .select('*')
    .eq('instance_id', instanceId)
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    instanceId: data.instance_id,
    totalProducts: data.total_products,
    processed: data.processed,
    currentStatus: data.current_status,
    syncedCount: data.synced_count,
    failedCount: data.failed_count,
    startedAt: data.started_at,
    updatedAt: data.updated_at,
    error: data.error ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Per-product Platform Targeting
// ---------------------------------------------------------------------------

/**
 * Get the target platforms for a specific product.
 * Returns null if no targeting set (= sync to all connected).
 */
export async function getProductPlatforms(
  productId: string,
): Promise<('gmc' | 'meta')[] | null> {
  const db = await getClient();
  const { data } = await db
    .from('sync_state')
    .select('platforms')
    .eq('product_id', productId)
    .limit(1)
    .single();
  return data?.platforms ?? null;
}

/**
 * Set the target platforms for one or more products.
 * Pass null to reset to "all connected platforms".
 */
export async function setProductPlatforms(
  productIds: string[],
  platforms: ('gmc' | 'meta')[] | null,
): Promise<void> {
  const db = await getClient();
  for (const productId of productIds) {
    await db
      .from('sync_state')
      .upsert(
        { product_id: productId, platform: 'gmc', status: 'pending', platforms },
        { onConflict: 'product_id,platform' },
      );
  }
}

/**
 * Get platforms map for a batch of product IDs.
 * Returns Map<productId, platforms[]|null>.
 */
export async function getBatchProductPlatforms(
  productIds: string[],
): Promise<Map<string, ('gmc' | 'meta')[] | null>> {
  const db = await getClient();
  const { data } = await db
    .from('sync_state')
    .select('product_id, platforms')
    .in('product_id', productIds);

  const map = new Map<string, ('gmc' | 'meta')[] | null>();
  for (const row of data ?? []) {
    if (!map.has(row.product_id)) {
      map.set(row.product_id, row.platforms ?? null);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// GMC Field Overrides CRUD
// ---------------------------------------------------------------------------

/**
 * Fetch all active GMC field overrides for a single product.
 * Returns a map of field name → override value.
 */
export async function getGmcOverrides(
  productId: string,
): Promise<Map<string, string>> {
  const db = await getClient();
  const { data, error } = await db
    .from('gmc_field_overrides')
    .select('field_name, override_value')
    .eq('product_id', productId);

  if (error) throw new Error(`Failed to fetch GMC overrides: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.field_name, row.override_value);
  }
  return map;
}

/**
 * Upsert GMC field overrides for a product.
 * Merges with existing overrides — does not delete fields not in the payload.
 */
export async function upsertGmcOverrides(
  productId: string,
  overrides: Record<string, string>,
): Promise<void> {
  if (Object.keys(overrides).length === 0) return;
  const db = await getClient();
  const rows = Object.entries(overrides).map(([field_name, override_value]) => ({
    product_id: productId,
    field_name,
    override_value,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from('gmc_field_overrides')
    .upsert(rows, { onConflict: 'product_id,field_name' });

  if (error) throw new Error(`Failed to upsert GMC overrides: ${error.message}`);
}

/**
 * Delete a single GMC field override for a product.
 */
export async function clearGmcOverride(
  productId: string,
  fieldName: string,
): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('gmc_field_overrides')
    .delete()
    .eq('product_id', productId)
    .eq('field_name', fieldName);

  if (error) throw new Error(`Failed to clear GMC override: ${error.message}`);
}

/**
 * Fetch override counts for a batch of product IDs.
 * Returns Map<productId, count>. Products with no overrides are not included.
 */
export async function getBatchOverrideCounts(
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const db = await getClient();
  const { data, error } = await db
    .from('gmc_field_overrides')
    .select('product_id')
    .in('product_id', productIds);

  if (error) throw new Error(`Failed to fetch override counts: ${error.message}`);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fetch overrides for a batch of product IDs.
 * Returns Map<productId, Map<fieldName, overrideValue>>.
 */
export async function getBatchGmcOverrides(
  productIds: string[],
): Promise<Map<string, Map<string, string>>> {
  if (productIds.length === 0) return new Map();
  const db = await getClient();
  const { data, error } = await db
    .from('gmc_field_overrides')
    .select('product_id, field_name, override_value')
    .in('product_id', productIds);

  if (error) throw new Error(`Failed to fetch batch GMC overrides: ${error.message}`);

  const result = new Map<string, Map<string, string>>();
  for (const row of data ?? []) {
    if (!result.has(row.product_id)) result.set(row.product_id, new Map());
    result.get(row.product_id)!.set(row.field_name, row.override_value);
  }
  return result;
}
