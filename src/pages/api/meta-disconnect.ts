import type { APIRoute } from 'astro';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;

    const config = await getAppConfig(instanceId);
    if (config) {
      config.metaConnected = false;
      await saveAppConfig(config);
    }

    return new Response(JSON.stringify({ disconnected: true }), {
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
