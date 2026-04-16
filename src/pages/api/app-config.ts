/**
 * GET /api/app-config — Returns the current AppConfig.
 * POST /api/app-config — Saves/updates AppConfig fields.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';
import type { FieldMappings } from '../../types/wix.types';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';
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
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as {
      instanceId: string;
      fieldMappings?: Record<string, { type: string; wixField?: string; defaultValue?: string }>;
      syncEnabled?: boolean;
      setupScreenShown?: boolean;
    };

    const instanceId = body.instanceId || 'default';

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

    if (body.fieldMappings !== undefined) {
      config.fieldMappings = body.fieldMappings as FieldMappings;
    }
    if (body.syncEnabled !== undefined) {
      config.syncEnabled = body.syncEnabled;
    }
    if (body.setupScreenShown !== undefined) config.setupScreenShown = body.setupScreenShown;

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
};
