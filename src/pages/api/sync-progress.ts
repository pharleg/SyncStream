import type { APIRoute } from 'astro';
import { getSyncProgress } from '../../backend/dataService';

export const GET: APIRoute = async ({ url }) => {
  try {
    const instanceId = url.searchParams.get('instanceId') ?? 'default';
    const progress = await getSyncProgress(instanceId);

    if (!progress) {
      return new Response(JSON.stringify({ progress: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ progress }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
