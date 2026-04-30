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
 * Verifies the Wix instance token from the Authorization header.
 *
 * auth.getTokenInfo() from @wix/essentials uses a different @wix/sdk-runtime
 * instance than @wix/astro's middleware, so the async-local-storage context
 * set by the middleware is invisible to it. We call the Wix token-info endpoint
 * directly instead — same network call the middleware makes via auth.elevated().
 */
export async function requireAuth(request: Request): Promise<AuthSession | Response> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return unauthorized();

  try {
    const res = await fetch('https://www.wixapis.com/oauth2/token-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: authorization }),
    });

    if (!res.ok) return unauthorized();

    const info = await res.json() as { instanceId?: string; active?: boolean };
    if (!info.active || !info.instanceId) return unauthorized();

    return { instanceId: info.instanceId };
  } catch {
    return unauthorized();
  }
}
