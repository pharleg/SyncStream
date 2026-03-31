import type { APIRoute } from 'astro';
import { getAllRules, saveRule, deleteRule } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? 'default';
    const rules = await getAllRules(instanceId);
    return new Response(JSON.stringify(rules), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const id = await saveRule({
      instanceId: body.instanceId ?? 'default',
      name: body.name,
      platform: body.platform ?? 'both',
      field: body.field,
      type: body.type,
      expression: body.expression,
      order: body.order ?? 0,
      enabled: body.enabled ?? true,
      ...(body.id ? { id: body.id } : {}),
    });
    return new Response(JSON.stringify({ success: true, id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    await deleteRule(id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
