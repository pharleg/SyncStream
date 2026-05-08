import type { APIRoute } from 'astro';
import { secrets } from '@wix/secrets';
import { createClient } from '@supabase/supabase-js';
import { handleMetaCallback, storeMetaCatalogId, getValidMetaAccessToken } from '../../backend/oauthService';
import { fetchMetaCatalogId } from '../../backend/metaClient';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';
import { requireAuth } from '../../lib/requireAuth';

async function getSupabase() {
  const [url, key] = await Promise.all([
    secrets.getSecretValue('supabase_project_url').then((r) => r.value ?? ''),
    secrets.getSecretValue('supabase_service_role').then((r) => r.value ?? ''),
  ]);
  return createClient(url, key);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;

    const supabase = await getSupabase();

    const { data, error } = await supabase
      .from('pending_oauth')
      .select('code')
      .eq('instance_id', instanceId)
      .eq('platform', 'meta')
      .single();

    if (error || !data) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await supabase
      .from('pending_oauth')
      .delete()
      .eq('instance_id', instanceId)
      .eq('platform', 'meta');

    await handleMetaCallback(instanceId, data.code);

    try {
      const accessToken = await getValidMetaAccessToken(instanceId);
      const catalogId = await fetchMetaCatalogId(accessToken);
      await storeMetaCatalogId(instanceId, catalogId);
    } catch (catalogErr) {
      console.error('[meta-complete-oauth] catalog fetch failed (non-blocking):', catalogErr);
    }

    let config = await getAppConfig(instanceId);
    if (!config) {
      config = {
        instanceId,
        gmcConnected: false,
        metaConnected: true,
        fieldMappings: {},
        syncEnabled: false,
        lastFullSync: null,
      };
    } else {
      config.metaConnected = true;
    }
    await saveAppConfig(config);

    return new Response(JSON.stringify({ connected: true }), {
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
