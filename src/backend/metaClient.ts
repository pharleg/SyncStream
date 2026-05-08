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

export async function batchUpsertMetaProducts(
  catalogId: string,
  products: MetaProduct[],
  accessToken: string,
): Promise<{ retailerId: string; success: boolean; error?: string }[]> {
  const requests = products.map((p) => ({
    method: 'UPDATE',
    retailer_id: p.retailerId,
    data: {
      name: p.title,
      description: p.description,
      availability: p.availability,
      condition: p.condition,
      price: p.price,
      link: p.link,
      image_link: p.imageLink,
      brand: p.brand,
    },
  }));

  const url = `${GRAPH_API}/${catalogId}/items_batch?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const raw = await res.text();
    return products.map((p) => ({ retailerId: p.retailerId, success: false, error: raw }));
  }

  return products.map((p) => ({ retailerId: p.retailerId, success: true }));
}

export async function upsertProduct(
  catalogId: string,
  product: MetaProduct,
  accessToken: string,
): Promise<MetaCatalogResponse> {
  const [result] = await batchUpsertMetaProducts(catalogId, [product], accessToken);
  return { id: result.retailerId, success: result.success, errors: result.error ? [{ code: 0, message: result.error, type: 'api' }] : undefined };
}

export async function deleteProduct(
  catalogId: string,
  retailerId: string,
  accessToken: string,
): Promise<void> {
  const url = `${GRAPH_API}/${catalogId}/items_batch?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ method: 'DELETE', retailer_id: retailerId }] }),
  });
  if (!res.ok) throw new Error(`Meta delete failed: ${await res.text()}`);
}
