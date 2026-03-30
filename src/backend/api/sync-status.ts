/**
 * GET /api/sync-status
 * Returns sync state summary and records for the Status dashboard.
 */
import type { APIContext } from 'astro';
import { items } from '@wix/data';
import { getAppConfig } from '../dataService';

interface SyncRecord {
  productId: string;
  platform: string;
  status: string;
  lastSynced: string;
  errorCount: number;
}

export async function GET(context: APIContext) {
  try {
    const instanceId =
      context.url.searchParams.get('instanceId') ?? '';

    const config = await getAppConfig(instanceId);

    // Query all SyncState records, most recent first
    const result = await items
      .query('SyncState')
      .descending('lastSynced')
      .limit(200)
      .find();

    const records: SyncRecord[] = (result.items ?? []).map((item) => ({
      productId: item.productId as string,
      platform: item.platform as string,
      status: item.status as string,
      lastSynced: item.lastSynced as string,
      errorCount: item.errorLog
        ? JSON.parse(item.errorLog as string).length
        : 0,
    }));

    const totalSynced = records.filter((r) => r.status === 'synced').length;
    const totalErrors = records.filter((r) => r.status === 'error').length;
    const totalPending = records.filter((r) => r.status === 'pending').length;

    return new Response(
      JSON.stringify({
        totalSynced,
        totalErrors,
        totalPending,
        lastFullSync: config?.lastFullSync?.toISOString() ?? null,
        records,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
