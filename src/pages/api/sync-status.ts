/**
 * GET /api/sync-status
 * Returns sync state summary, per-platform health, records, top issues, and grouped issue types.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, querySyncStates, getTopIssues } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';

    const [config, states] = await Promise.all([
      getAppConfig(instanceId),
      querySyncStates(500),
    ]);

    const records = states.map((s) => ({
      productId: s.productId,
      platform: s.platform,
      status: s.status,
      lastSynced: s.lastSynced.toISOString(),
      errorCount: Array.isArray(s.errorLog) ? s.errorLog.length : 0,
      errorMessages: Array.isArray(s.errorLog)
        ? s.errorLog.map((e: any) => e.message as string)
        : [],
      errorLog: Array.isArray(s.errorLog) ? s.errorLog : [],
    }));

    // Counts across all platforms (deduplicate by productId for totals)
    const productStatuses = new Map<string, 'synced' | 'error' | 'warning' | 'pending'>();
    for (const s of states) {
      const current = productStatuses.get(s.productId);
      const log = Array.isArray(s.errorLog) ? s.errorLog : [];
      const hasErrors = log.some((e: any) => e.severity === 'error' || !e.severity) && s.status === 'error';
      const hasWarnings = log.some((e: any) => e.severity === 'warning') && s.status !== 'error';
      const nextStatus: 'synced' | 'error' | 'warning' | 'pending' =
        hasErrors ? 'error' : hasWarnings ? 'warning' : (s.status as 'synced' | 'error' | 'pending');
      // error > warning > synced > pending
      if (!current || current === 'pending' ||
          (current === 'synced' && nextStatus !== 'pending') ||
          (current === 'warning' && nextStatus === 'error')) {
        productStatuses.set(s.productId, nextStatus);
      }
    }

    const allStatuses = Array.from(productStatuses.values());
    const totalSynced = allStatuses.filter((v) => v === 'synced').length;
    const totalErrors = allStatuses.filter((v) => v === 'error').length;
    const totalPending = allStatuses.filter((v) => v === 'pending').length;
    const totalWarnings = allStatuses.filter((v) => v === 'warning').length;

    // Per-platform health
    const gmcStates = states.filter((s) => s.platform === 'gmc');
    const metaStates = states.filter((s) => s.platform === 'meta');
    const gmcSynced = gmcStates.filter((s) => s.status === 'synced').length;
    const gmcErrors = gmcStates.filter((s) => s.status === 'error').length;
    const metaSynced = metaStates.filter((s) => s.status === 'synced').length;
    const metaErrors = metaStates.filter((s) => s.status === 'error').length;
    const gmcTotal = gmcStates.length;
    const metaTotal = metaStates.length;

    // Group blocking validation errors by field for the FixWizard issueGroups
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

    // Top issues for dashboard panel (errors + warnings by type)
    const [gmcTopIssues, metaTopIssues] = await Promise.all([
      getTopIssues(instanceId, 'gmc', 6),
      getTopIssues(instanceId, 'meta', 6),
    ]);

    return new Response(
      JSON.stringify({
        totalSynced,
        totalErrors,
        totalPending,
        totalWarnings,
        lastFullSync: config?.lastFullSync?.toISOString() ?? null,
        records,
        issueGroups,
        platformHealth: {
          gmc: {
            connected: config?.gmcConnected ?? false,
            total: gmcTotal,
            synced: gmcSynced,
            errors: gmcErrors,
            pct: gmcTotal > 0 ? Math.round((gmcSynced / gmcTotal) * 100) : 0,
          },
          meta: {
            connected: config?.metaConnected ?? false,
            total: metaTotal,
            synced: metaSynced,
            errors: metaErrors,
            pct: metaTotal > 0 ? Math.round((metaSynced / metaTotal) * 100) : 0,
          },
        },
        topIssues: {
          gmc: gmcTopIssues,
          meta: metaTopIssues,
        },
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
