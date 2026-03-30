/**
 * oauthService.ts
 *
 * Handles OAuth flows for GMC and Meta.
 * Exchanges auth codes for tokens, stores them in Wix Secrets Manager.
 * Keys: gmc_access_token_{instanceId}, gmc_refresh_token_{instanceId},
 *        meta_access_token_{instanceId}, meta_refresh_token_{instanceId}
 */

export async function initiateGmcOAuth(
  _instanceId: string,
): Promise<string> {
  // TODO Phase 2: return OAuth URL
  throw new Error('Not implemented');
}

export async function handleGmcCallback(
  _instanceId: string,
  _code: string,
): Promise<void> {
  // TODO Phase 2: exchange code, store tokens
  throw new Error('Not implemented');
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
