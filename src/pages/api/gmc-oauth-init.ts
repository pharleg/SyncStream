/**
 * GET /api/gmc-oauth-init
 * Returns the GMC OAuth authorization URL.
 */
import type { APIRoute } from 'astro';
import { initiateGmcOAuth } from '../../backend/oauthService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';
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
