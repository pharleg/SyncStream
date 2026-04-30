// src/pages/api/sync-events.ts
import type { APIRoute } from 'astro';
import { getRecentEvents } from '../../backend/dataService';
import { requireAuth } from '../../lib/requireAuth';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const url = new URL(request.url);
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '10', 10);
    const limit = Math.min(isNaN(rawLimit) ? 10 : rawLimit, 100);

    const events = await getRecentEvents(instanceId, limit);
    return new Response(JSON.stringify({ events }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
