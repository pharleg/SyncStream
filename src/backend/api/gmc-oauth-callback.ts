/**
 * GET /api/gmc-oauth-callback
 * Google redirects here after OAuth consent.
 * Exchanges code for tokens and stores them.
 */
import type { APIContext } from 'astro';
import { handleGmcCallback } from '../oauthService';
import { getAppConfig, saveAppConfig } from '../dataService';

export async function GET(context: APIContext) {
  const code = context.url.searchParams.get('code');
  const instanceId = context.url.searchParams.get('state') ?? '';

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
    await handleGmcCallback(instanceId, code);

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
      };
    } else {
      config.gmcConnected = true;
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
