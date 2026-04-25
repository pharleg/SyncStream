import type { APIRoute } from 'astro';
import { enhanceProducts } from '../../backend/aiEnhancer';
import { getAppConfig } from '../../backend/dataService';
import { BillingError } from '../../backend/billingService';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';

    const config = await getAppConfig(instanceId);
    if (!config) {
      return new Response(JSON.stringify({ error: 'App not configured' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Import Wix stores to fetch products
    const { productsV3 } = await import('@wix/stores');
    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 100 } },
      { fields: ['PLAIN_DESCRIPTION', 'MEDIA_ITEMS_INFO'] },
    );

    const products = (response.products ?? []) as any[];
    const results = await enhanceProducts(products, instanceId, config.aiEnhancementStyle);

    return new Response(JSON.stringify({
      success: true,
      enhanced: results.size,
      total: products.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof BillingError) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? 'default';

    // Import supabase client to count enhanced content
    const { createClient } = await import('@supabase/supabase-js');
    const { secrets } = await import('@wix/secrets');
    const supabaseUrl = (await secrets.getSecretValue('supabase_project_url')).value!;
    const supabaseKey = (await secrets.getSecretValue('supabase_service_role')).value!;
    const db = createClient(supabaseUrl, supabaseKey);

    const { count, error } = await db
      .from('enhanced_content')
      .select('*', { count: 'exact', head: true })
      .eq('instance_id', instanceId);

    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({ enhancedCount: count ?? 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
