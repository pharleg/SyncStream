import type { APIRoute } from 'astro';
import { getProductPlatforms, setProductPlatforms } from '../../backend/dataService';

/** GET: query platforms for a product. POST: set platforms for one or more products. */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  if (!productId) {
    return new Response(JSON.stringify({ error: 'productId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const platforms = await getProductPlatforms(productId);
  return new Response(JSON.stringify({ productId, platforms }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const productIds: string[] = body.productIds;
    const platforms: ('gmc' | 'meta')[] | null = body.platforms;

    if (!productIds || productIds.length === 0) {
      return new Response(JSON.stringify({ error: 'productIds required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (platforms !== null) {
      const valid = ['gmc', 'meta'];
      if (!platforms.every((p) => valid.includes(p))) {
        return new Response(JSON.stringify({ error: 'Invalid platform. Use "gmc", "meta", or null for all.' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    await setProductPlatforms(productIds, platforms);

    return new Response(JSON.stringify({
      success: true,
      updated: productIds.length,
      platforms,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update platforms';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
