/**
 * GET /api/gmc-oauth-init
 * Returns the GMC OAuth authorization URL.
 */
import type { APIRoute } from 'astro';
import { initiateGmcOAuth } from '../../backend/oauthService';
import { requireAuth } from '../../lib/requireAuth';

export const GET: APIRoute = async () => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const authUrl = await initiateGmcOAuth(instanceId);
    return new Response(JSON.stringify({ authUrl }), {
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
