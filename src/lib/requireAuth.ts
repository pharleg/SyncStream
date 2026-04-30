import { auth } from '@wix/essentials';

const UNAUTHORIZED = new Response(JSON.stringify({ error: 'Unauthorized' }), {
  status: 401,
  headers: { 'Content-Type': 'application/json' },
});

export interface AuthSession {
  instanceId: string;
}

/**
 * Verifies the Wix instance token sent by httpClient.fetchWithAuth.
 * Returns { instanceId } on success, or a 401 Response on failure.
 * All API routes must call this before processing any request.
 */
export async function requireAuth(): Promise<AuthSession | Response> {
  try {
    const tokenInfo = await auth.getTokenInfo();
    if (!tokenInfo.instanceId) return UNAUTHORIZED;
    return { instanceId: tokenInfo.instanceId };
  } catch {
    return UNAUTHORIZED;
  }
}
