/**
 * metaClient.ts
 *
 * All Meta Graph API Catalog calls live here.
 * No direct fetch calls to Meta should exist elsewhere.
 */

import type { MetaProduct, MetaCatalogResponse } from '../types/meta.types';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

export async function fetchMetaCatalogId(accessToken: string): Promise<string> {
  const bizRes = await fetch(
    `${GRAPH_API}/me/businesses?fields=id,name&access_token=${accessToken}`,
  );
  if (!bizRes.ok) throw new Error(`Meta businesses fetch failed: ${await bizRes.text()}`);
  const biz = (await bizRes.json()) as { data: { id: string; name: string }[] };
  if (!biz.data?.length) throw new Error('No Meta Business accounts found');

  const businessId = biz.data[0].id;
  const catRes = await fetch(
    `${GRAPH_API}/${businessId}/owned_product_catalogs?fields=id,name&access_token=${accessToken}`,
  );
  if (!catRes.ok) throw new Error(`Meta catalogs fetch failed: ${await catRes.text()}`);
  const catalogs = (await catRes.json()) as { data: { id: string; name: string }[] };
  if (!catalogs.data?.length) throw new Error('No Meta Product Catalogs found');
  return catalogs.data[0].id;
}

export async function upsertProduct(
  _catalogId: string,
  _product: MetaProduct,
  _accessToken: string,
): Promise<MetaCatalogResponse> {
  // TODO Phase 4: implement Meta upsert
  throw new Error('Not implemented');
}

export async function deleteProduct(
  _catalogId: string,
  _retailerId: string,
  _accessToken: string,
): Promise<void> {
  // TODO Phase 4: implement Meta delete
  throw new Error('Not implemented');
}
