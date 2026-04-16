/**
 * GET /api/sync-status
 * Returns sync state summary, records, and grouped issue types.
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

    // Group blocking validation errors by field (skip 'api' errors and warnings)
    const fieldCounts = new Map<string, { count: number; message: string }>();
    for (const s of states) {
      if (s.status === 'error' && Array.isArray(s.errorLog)) {
        for (const err of s.errorLog) {
          if (err.severity === 'error' && err.field !== 'api') {
            const existing = fieldCounts.get(err.field);
            if (existing) {
              existing.count++;
            } else {
              fieldCounts.set(err.field, { count: 1, message: err.message });
            }
          }
        }
      }
    }
    const issueGroups = Array.from(fieldCounts.entries())
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([field, { count, message }]) => ({ field, count, message }));

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
        issueGroups,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
