/**
 * GET /api/app-config — Returns the current AppConfig.
 * POST /api/app-config — Saves/updates AppConfig fields.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';
import type { FieldMappings } from '../../types/wix.types';
import { requireAuth } from '../../lib/requireAuth';

export const GET: APIRoute = async () => {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
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
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json() as {
      gmcConnected?: boolean;
      fieldMappings?: Record<string, { type: string; wixField?: string; defaultValue?: string }>;
      syncEnabled?: boolean;
      setupScreenShown?: boolean;
      aiEnhancementEnabled?: boolean;
      aiEnhancementStyle?: string;
    };

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

    // gmcConnected is only set by the OAuth completion flow — block direct writes
    // to prevent a caller falsely marking GMC as connected without valid tokens.
    if (body.fieldMappings !== undefined) {
      config.fieldMappings = body.fieldMappings as FieldMappings;
    }
    if (body.syncEnabled !== undefined) {
      config.syncEnabled = body.syncEnabled;
    }
    if (body.setupScreenShown !== undefined) {
      config.setupScreenShown = body.setupScreenShown;
    }
    if (body.aiEnhancementEnabled !== undefined) {
      config.aiEnhancementEnabled = body.aiEnhancementEnabled;
    }
    if (body.aiEnhancementStyle !== undefined) {
      config.aiEnhancementStyle = body.aiEnhancementStyle;
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
};
