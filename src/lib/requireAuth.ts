import { auth } from '@wix/essentials';

export interface AuthSession {
  instanceId: string;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Verifies the Wix instance token sent by httpClient.fetchWithAuth.
 * Returns { instanceId } on success, or a 401 Response on failure.
 * All API routes must call this before processing any request.
 *
 * Creates a fresh Response each call — Cloudflare Workers Response body
 * streams can only be consumed once; a module-level singleton would return
 * an empty body on the second request through the same isolate.
 */
export async function requireAuth(): Promise<AuthSession | Response> {
  try {
    const tokenInfo = await auth.getTokenInfo();
    if (!tokenInfo.instanceId) return unauthorized();
    return { instanceId: tokenInfo.instanceId };
  } catch {
    return unauthorized();
  }
}
