import type { APIRoute } from 'astro';
import { secrets } from '@wix/secrets';
import { createClient } from '@supabase/supabase-js';
import { handleGmcCallback, getValidGmcAccessToken, getGmcTokens } from '../../backend/oauthService';
import { registerGcpProject, createDataSource } from '../../backend/gmcClient';
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
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    await request.json();

    const supabase = await getSupabase();

    const { data, error } = await supabase
      .from('pending_oauth')
      .select('code')
      .eq('instance_id', instanceId)
      .single();

    if (error || !data) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('pending_oauth').delete().eq('instance_id', instanceId);

    await handleGmcCallback(instanceId, data.code);

    const accessToken = await getValidGmcAccessToken(instanceId);
    const tokens = await getGmcTokens(instanceId);
    await registerGcpProject(tokens.merchantId, accessToken);
    const dataSourceId = await createDataSource(tokens.merchantId, accessToken);

    let config = await getAppConfig(instanceId);
    if (!config) {
      config = {
        instanceId,
        gmcConnected: true,
        metaConnected: false,
        fieldMappings: {},
        syncEnabled: false,
        lastFullSync: null,
        gmcDataSourceId: dataSourceId,
      };
    } else {
      config.gmcConnected = true;
      config.gmcDataSourceId = dataSourceId;
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
