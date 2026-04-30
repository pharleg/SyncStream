import type { APIRoute } from 'astro';
import { getCreditBalance, getPlan } from '../../backend/billingService';
import { requireAuth } from '../../lib/requireAuth';

export const GET: APIRoute = async () => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;

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
