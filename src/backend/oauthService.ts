/**
 * oauthService.ts
 *
 * Handles OAuth flows for GMC and Meta.
 * Exchanges auth codes for tokens, stores them in Wix Secrets Manager.
 * Keys: gmc_access_token_{instanceId}, gmc_refresh_token_{instanceId},
 *        meta_access_token_{instanceId}, meta_refresh_token_{instanceId}
 */

import { secrets } from '@wix/secrets';
import type { GmcTokens } from '../types/gmc.types';

const GMC_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMC_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMC_SCOPE = 'https://www.googleapis.com/auth/content';

/** Upsert a secret by name — create if new, update if exists. */
async function upsertSecret(name: string, value: string): Promise<void> {
  const { secrets: existing } = await secrets.listSecretInfo();
  const found = existing?.find((s) => s.name === name);
  if (found?._id) {
    await secrets.updateSecret(found._id, { value });
  } else {
    await secrets.createSecret({ name, value });
  }
}

/** In-memory cache for secrets within a single request. */
const _secretCache = new Map<string, string>();

/** Get a secret value by name, with in-request caching. */
async function getSecret(name: string): Promise<string> {
  const cached = _secretCache.get(name);
  if (cached !== undefined) return cached;
  const result = await secrets.getSecretValue(name);
  const value = result.value ?? '';
  _secretCache.set(name, value);
  return value;
}

let _credentialsCache: { clientId: string; clientSecret: string; redirectUri: string } | null = null;

async function getGmcClientCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}> {
  if (_credentialsCache) return _credentialsCache;
  const [clientId, clientSecret, redirectUri] = await Promise.all([
    getSecret('gmc_client_id'),
    getSecret('gmc_client_secret'),
    getSecret('gmc_redirect_uri'),
  ]);
  _credentialsCache = { clientId, clientSecret, redirectUri };
  return _credentialsCache;
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

  await upsertSecret(
    `gmc_access_token_${instanceId}`,
    data.access_token,
  );
  await upsertSecret(
    `gmc_refresh_token_${instanceId}`,
    data.refresh_token,
  );
  await upsertSecret(
    `gmc_token_expiry_${instanceId}`,
    String(Date.now() + data.expires_in * 1000),
  );
}

export async function getGmcTokens(
  instanceId: string,
): Promise<GmcTokens> {
  const [accessToken, refreshToken, expiresAtStr, merchantId] =
    await Promise.all([
      getSecret(`gmc_access_token_${instanceId}`),
      getSecret(`gmc_refresh_token_${instanceId}`),
      getSecret(`gmc_token_expiry_${instanceId}`),
      getSecret(`gmc_merchant_id_${instanceId}`),
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
  const refreshToken = await getSecret(
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

  await upsertSecret(
    `gmc_access_token_${instanceId}`,
    data.access_token,
  );
  await upsertSecret(
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

/**
 * Returns the full GmcTokens with a guaranteed-valid access token.
 * Use instead of calling getValidGmcAccessToken + getGmcTokens separately
 * to avoid duplicate Secrets Manager subrequests.
 */
export async function getValidGmcTokens(
  instanceId: string,
): Promise<GmcTokens> {
  const tokens = await getGmcTokens(instanceId);
  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens;
  }
  const accessToken = await refreshGmcTokens(instanceId);
  return { ...tokens, accessToken };
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
