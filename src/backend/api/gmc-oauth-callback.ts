/**
 * GET /api/gmc-oauth-callback
 * Google redirects here after OAuth consent.
 * Exchanges code for tokens and stores them.
 */
import type { APIContext } from 'astro';
import { handleGmcCallback, getValidGmcAccessToken, getGmcTokens } from '../oauthService';
import { registerGcpProject, createDataSource } from '../gmcClient';
import { getAppConfig, saveAppConfig } from '../dataService';

export async function GET(context: APIContext) {
  const code = context.url.searchParams.get('code');
  const instanceId = context.url.searchParams.get('state') ?? '';

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
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

    // Redirect back to connect page with success
    return context.redirect('/dashboard/connect?gmc=connected');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(`OAuth failed: ${message}`, { status: 500 });
  }
}
