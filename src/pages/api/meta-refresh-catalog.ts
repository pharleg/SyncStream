import type { APIRoute } from 'astro';
import { getValidMetaAccessToken, storeMetaCatalogId, getMetaTokens } from '../../backend/oauthService';
import { fetchMetaBusinessesAndCatalogs, type MetaBusiness, type MetaCatalog } from '../../backend/metaClient';
import { requireAuth } from '../../lib/requireAuth';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const [accessToken, tokens] = await Promise.all([
      getValidMetaAccessToken(instanceId),
      getMetaTokens(instanceId),
    ]);
    const { businesses, catalogs } = await fetchMetaBusinessesAndCatalogs(accessToken);

    // Auto-select if unambiguous
    let selectedCatalogId = tokens.catalogId ?? '';
    if (!selectedCatalogId && catalogs.length === 1) {
      selectedCatalogId = catalogs[0].id;
      await storeMetaCatalogId(instanceId, selectedCatalogId);
    }

    return new Response(JSON.stringify({ businesses, catalogs, selectedCatalogId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const { catalogId } = (await request.json()) as { catalogId: string };
    if (!catalogId) return new Response(JSON.stringify({ error: 'catalogId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    await storeMetaCatalogId(instanceId, catalogId);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
