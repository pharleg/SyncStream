// src/pages/api/sync-events.ts
import type { APIRoute } from 'astro';
import { getRecentEvents } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';
    const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);

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
