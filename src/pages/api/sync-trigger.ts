/**
 * POST /api/sync-trigger
 * Triggers a full sync for the given instance.
 */
import type { APIRoute } from 'astro';
import { runFullSync } from '../../backend/syncService';
import type { Platform } from '../../types/sync.types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      instanceId: string;
      platforms?: Platform[];
    };

    const result = await runFullSync(body.instanceId, {
      platforms: body.platforms ?? ['gmc'],
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
