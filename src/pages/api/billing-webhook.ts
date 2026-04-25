import type { APIRoute } from 'astro';
import { setPlanTier } from '../../backend/billingService';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';

/**
 * Handles Wix app instance change events on plan upgrade/downgrade.
 * Verify exact eventType strings in Wix App Management docs before deploying.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as {
      eventType?: string;
      instanceId?: string;
      data?: {
        instance?: {
          instanceId?: string;
          billing?: {
            packageName?: string;
            packageId?: string;
          };
        };
      };
    };

    const instanceId = body.instanceId ?? body.data?.instance?.instanceId;
    if (!instanceId) {
      return new Response(JSON.stringify({ error: 'Missing instanceId' }), { status: 400 });
    }

    const eventType = body.eventType ?? '';
    const packageName = body.data?.instance?.billing?.packageName?.toLowerCase() ?? '';

    const tier: 'free' | 'pro' = packageName.includes('pro') ? 'pro' : 'free';

    if (
      eventType.includes('upgraded') ||
      eventType.includes('activated') ||
      eventType.includes('changed') ||
      eventType.includes('INSTANCE_CHANGED')
    ) {
      await setPlanTier(instanceId, tier);

      const config = await getAppConfig(instanceId);
      if (config) {
        config.planTier = tier;
        await saveAppConfig(config);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
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
