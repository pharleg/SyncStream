import type { APIRoute } from 'astro';
import { getCreditBalance, getPlan } from '../../backend/billingService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? 'default';

    const [plan, balance] = await Promise.all([
      getPlan(instanceId),
      getCreditBalance(instanceId),
    ]);

    return new Response(
      JSON.stringify({
        plan,
        creditsRemaining: balance.remaining,
        resetDate: balance.resetDate.toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
