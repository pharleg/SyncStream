import type { APIRoute } from 'astro';
import { createHmac } from 'node:crypto';
import { setPlanTier } from '../../backend/billingService';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';

/**
 * Verify Wix webhook HMAC-SHA256 signature.
 * Wix signs the raw request body with the app secret and sends the result
 * base64-encoded in the x-wix-signature header.
 */
async function verifyWixSignature(request: Request, rawBody: string): Promise<boolean> {
  const signature = request.headers.get('x-wix-signature');
  if (!signature) return false;

  // App secret comes from Wix App Dashboard > Webhooks > secret key.
  // Stored in Wix Secrets Manager under 'wix_webhook_secret'.
  const { secrets } = await import('@wix/secrets');
  let appSecret: string;
  try {
    const secretResult = await secrets.getSecretValue('wix_webhook_secret');
    appSecret = secretResult.value ?? '';
  } catch {
    return false;
  }

  if (!appSecret) return false;

  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('base64');

  return expected === signature;
}

/**
 * Handles Wix app instance change events on plan upgrade/downgrade.
 * Verify exact eventType strings in Wix App Management docs before deploying.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const rawBody = await request.text();

    // Verify Wix webhook signature before processing any payload
    const isValid = await verifyWixSignature(request, rawBody);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const body = JSON.parse(rawBody) as {
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
