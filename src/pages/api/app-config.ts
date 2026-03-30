/**
 * GET /api/app-config
 * Returns the current AppConfig for the instance.
 */
import type { APIContext } from 'astro';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';

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

export async function POST(context: APIContext) {
  try {
    const body = await context.request.json() as {
      instanceId: string;
      fieldMappings?: Record<string, { type: string; wixField?: string; defaultValue?: string }>;
      syncEnabled?: boolean;
    };

    const instanceId = body.instanceId || 'default';

    // Get existing config or create new
    let config = await getAppConfig(instanceId);
    if (!config) {
      config = {
        instanceId,
        gmcConnected: false,
        metaConnected: false,
        fieldMappings: {},
        syncEnabled: false,
        lastFullSync: null,
      };
    }

    // Apply updates
    if (body.fieldMappings !== undefined) {
      config.fieldMappings = body.fieldMappings as import('../../types/wix.types').FieldMappings;
    }
    if (body.syncEnabled !== undefined) {
      config.syncEnabled = body.syncEnabled;
    }

    await saveAppConfig(config);

    return new Response(JSON.stringify({ success: true }), {
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
