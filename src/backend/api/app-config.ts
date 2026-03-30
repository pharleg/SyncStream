/**
 * GET /api/app-config
 * Returns the current AppConfig for the instance.
 */
import type { APIContext } from 'astro';
import { getAppConfig } from '../dataService';

export async function GET(context: APIContext) {
  try {
    const instanceId =
      context.url.searchParams.get('instanceId') ?? '';
    const config = await getAppConfig(instanceId);

    return new Response(JSON.stringify(config), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
