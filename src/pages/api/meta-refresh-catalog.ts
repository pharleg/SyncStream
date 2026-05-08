import type { APIRoute } from 'astro';
import { getValidMetaAccessToken, storeMetaCatalogId } from '../../backend/oauthService';
import { fetchMetaCatalogId } from '../../backend/metaClient';
import { requireAuth } from '../../lib/requireAuth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;

    const accessToken = await getValidMetaAccessToken(instanceId);
    const catalogId = await fetchMetaCatalogId(accessToken);
    await storeMetaCatalogId(instanceId, catalogId);

    return new Response(JSON.stringify({ catalogId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
