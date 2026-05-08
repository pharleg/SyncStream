import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/requireAuth';
import { secrets } from '@wix/secrets';
import { createClient } from '@supabase/supabase-js';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;

    const [url, key] = await Promise.all([
      secrets.getSecretValue('supabase_project_url').then((r) => r.value ?? ''),
      secrets.getSecretValue('supabase_service_role').then((r) => r.value ?? ''),
    ]);
    const db = createClient(url, key);

    const { error } = await db
      .from('app_config')
      .update({ meta_connected: false })
      .eq('instance_id', instanceId);

    if (error) throw new Error(error.message);

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
