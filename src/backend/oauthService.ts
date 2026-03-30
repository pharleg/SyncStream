/**
 * oauthService.ts
 *
 * Handles OAuth flows for GMC and Meta.
 * Exchanges auth codes for tokens, stores them in Wix Secrets Manager.
 * Keys: gmc_access_token_{instanceId}, gmc_refresh_token_{instanceId},
 *        meta_access_token_{instanceId}, meta_refresh_token_{instanceId}
 */

import { secrets } from '@wix/essentials';
import type { GmcTokens } from '../types/gmc.types';

const GMC_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMC_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMC_SCOPE = 'https://www.googleapis.com/auth/content';

async function getGmcClientCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}> {
  const clientId = await secrets.getSecret('gmc_client_id');
  const clientSecret = await secrets.getSecret('gmc_client_secret');
  const redirectUri = await secrets.getSecret('gmc_redirect_uri');
  return { clientId, clientSecret, redirectUri };
}

export async function initiateGmcOAuth(
  instanceId: string,
): Promise<string> {
  const { clientId, redirectUri } = await getGmcClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMC_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: instanceId,
  });
  return `${GMC_AUTH_URL}?${params.toString()}`;
}

export async function handleGmcCallback(
  instanceId: string,
  code: string,
): Promise<void> {
  const { clientId, clientSecret, redirectUri } =
    await getGmcClientCredentials();

  const response = await fetch(GMC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GMC token exchange failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  await secrets.createOrUpdateSecret(
    `gmc_access_token_${instanceId}`,
    data.access_token,
  );
  await secrets.createOrUpdateSecret(
    `gmc_refresh_token_${instanceId}`,
    data.refresh_token,
  );
  await secrets.createOrUpdateSecret(
    `gmc_token_expiry_${instanceId}`,
    String(Date.now() + data.expires_in * 1000),
  );
}

export async function getGmcTokens(
  instanceId: string,
): Promise<GmcTokens> {
  const [accessToken, refreshToken, expiresAtStr, merchantId] =
    await Promise.all([
      secrets.getSecret(`gmc_access_token_${instanceId}`),
      secrets.getSecret(`gmc_refresh_token_${instanceId}`),
      secrets.getSecret(`gmc_token_expiry_${instanceId}`),
      secrets.getSecret(`gmc_merchant_id_${instanceId}`),
    ]);

  return {
    accessToken,
    refreshToken,
    expiresAt: Number(expiresAtStr),
    merchantId,
  };
}

export async function refreshGmcTokens(
  instanceId: string,
): Promise<string> {
  const { clientId, clientSecret } = await getGmcClientCredentials();
  const refreshToken = await secrets.getSecret(
    `gmc_refresh_token_${instanceId}`,
  );

  const response = await fetch(GMC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GMC token refresh failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  await secrets.createOrUpdateSecret(
    `gmc_access_token_${instanceId}`,
    data.access_token,
  );
  await secrets.createOrUpdateSecret(
    `gmc_token_expiry_${instanceId}`,
    String(Date.now() + data.expires_in * 1000),
  );

  return data.access_token;
}

/** Get a valid access token, refreshing if expired. */
export async function getValidGmcAccessToken(
  instanceId: string,
): Promise<string> {
  const tokens = await getGmcTokens(instanceId);
  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens.accessToken;
  }
  return refreshGmcTokens(instanceId);
}

export async function initiateMetaOAuth(
  _instanceId: string,
): Promise<string> {
  // TODO Phase 4: return OAuth URL
  throw new Error('Not implemented');
}

export async function handleMetaCallback(
  _instanceId: string,
  _code: string,
): Promise<void> {
  // TODO Phase 4: exchange code, store tokens
  throw new Error('Not implemented');
}
