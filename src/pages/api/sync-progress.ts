import type { APIRoute } from 'astro';
import { getSyncProgress } from '../../backend/dataService';
import { requireAuth } from '../../lib/requireAuth';

export const GET: APIRoute = async () => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
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
