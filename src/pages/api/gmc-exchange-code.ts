/**
 * POST /api/gmc-exchange-code
 * Exchanges a Google OAuth authorization code for tokens.
 * Called from the dashboard via httpClient.fetchWithAuth (has Wix auth).
 */
import type { APIRoute } from 'astro';
import { handleGmcCallback, getValidGmcAccessToken, getGmcTokens } from '../../backend/oauthService';
import { registerGcpProject, createDataSource } from '../../backend/gmcClient';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { code, instanceId } = await request.json() as {
      code: string;
      instanceId: string;
    };

    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing authorization code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await handleGmcCallback(instanceId, code);

    // Register GCP project and create API data source
    const accessToken = await getValidGmcAccessToken(instanceId);
    const tokens = await getGmcTokens(instanceId);
    await registerGcpProject(tokens.merchantId, accessToken);
    const dataSourceId = await createDataSource(tokens.merchantId, accessToken);

    // Mark GMC as connected in AppConfig
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

    return new Response(JSON.stringify({ success: true }), {
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
