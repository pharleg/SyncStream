/**
 * GET /api/sync-status
 * Returns sync state summary and records for the Status dashboard.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, querySyncStates } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';

    const config = await getAppConfig(instanceId);
    const states = await querySyncStates(200);

    const records = states.map((s) => ({
      productId: s.productId,
      platform: s.platform,
      status: s.status,
      lastSynced: s.lastSynced.toISOString(),
      errorCount: Array.isArray(s.errorLog) ? s.errorLog.length : 0,
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
};
