export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const instanceId = url.searchParams.get('state') ?? 'default';

    if (!code) {
      return new Response('Missing authorization code', { status: 400 });
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/pending_oauth`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ instance_id: instanceId, code }),
    });

    if (!res.ok) {
      return new Response(`Failed to store auth code: ${await res.text()}`, { status: 500 });
    }

    return Response.redirect(
      'https://manage.wix.com/dashboard/014335d7-e2c8-432f-9291-ef9889b31253/6eb9d379-bb51-4edf-8946-60d6f6344b20/sync-stream',
      302
    );
  },
};
