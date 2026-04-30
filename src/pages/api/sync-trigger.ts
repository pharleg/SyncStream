/**
 * POST /api/sync-trigger
 * Triggers a paginated full sync for the given instance.
 * Returns final results after all chunks are processed.
 */
import type { APIRoute } from 'astro';
import { runPaginatedSync } from '../../backend/syncService';
import { BillingError } from '../../backend/billingService';
import type { Platform } from '../../types/sync.types';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = (await request.json()) as {
      platforms?: Platform[];
    };

    const result = await runPaginatedSync(
      instanceId,
      body.platforms ?? ['gmc'],
    );

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof BillingError) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
