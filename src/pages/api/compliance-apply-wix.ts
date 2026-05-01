/**
 * POST /api/compliance-apply-wix
 *
 * Writes compliance fixes back to Wix products.
 * Handles: title, description, and per-variant SKUs (variantSku_<variantId> keys).
 * All other fields (brand, condition, link, imageLink) are GMC-only overrides.
 *
 * Body: { productId: string; fixes: Record<string, string> | Array<{ field, value }> }
 * Response: { applied: number; failed: number; results: Array<{ productId, success, error? }> }
 */
import type { APIRoute } from 'astro';
import { applyEnhancementsToWix } from '../../backend/aiEnhancer';
import { updateCachedProductFields } from '../../backend/dataService';
import { requireAuth } from '../../lib/requireAuth';

const WIX_FIXABLE_FIELDS = new Set(['title', 'description']);

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;
    const body = await request.json();
    const productId: string = body.productId;

    // Accept both array [{ field, value }] and object { field: value } formats
    let rawFixes: Array<{ field: string; value: string }> = [];
    if (Array.isArray(body.fixes)) {
      rawFixes = body.fixes;
    } else if (body.fixes && typeof body.fixes === 'object') {
      rawFixes = Object.entries(body.fixes as Record<string, string>).map(([field, value]) => ({ field, value: String(value) }));
    }

    // Separate title/description fixes from per-variant SKU fixes
    const fields: { title?: string; description?: string } = {};
    const variantSkus: Record<string, string> = {}; // variantId → sku

    for (const fix of rawFixes) {
      if (fix.field.startsWith('variantSku_')) {
        const variantId = fix.field.slice('variantSku_'.length);
        if (variantId && fix.value) variantSkus[variantId] = fix.value;
      } else if (fix.field === 'offerId' && fix.value) {
        // Single-variant offerId fix — handled via variantSkus with sentinel key
        // The backend will detect no variantIds and fall back to single-variant update
        variantSkus['__single__'] = fix.value;
      } else if (WIX_FIXABLE_FIELDS.has(fix.field)) {
        if (fix.field === 'title') fields.title = fix.value;
        if (fix.field === 'description') fields.description = fix.value;
      }
    }

    const results: Array<{ productId: string; success: boolean; error?: string }> = [];

    // Apply title/description updates
    if (fields.title || fields.description) {
      const updates = [{ productId, title: fields.title ?? '', description: fields.description ?? '' }];
      const wixResults = await applyEnhancementsToWix(instanceId, updates);

      for (const result of wixResults) {
        results.push(result);
        if (result.success) {
          const cacheUpdates: { name?: string; description?: string; plainDescription?: string } = {};
          if (fields.title) { cacheUpdates.name = fields.title; }
          if (fields.description) {
            cacheUpdates.description = fields.description;
            cacheUpdates.plainDescription = fields.description;
          }
          await updateCachedProductFields(instanceId, result.productId, cacheUpdates);
        }
      }
    }

    // Apply variant SKU updates
    if (Object.keys(variantSkus).length > 0) {
      const skuResult = await applyVariantSkusToWix(instanceId, productId, variantSkus);
      results.push(skuResult);
    }

    if (results.length === 0) {
      return new Response(JSON.stringify({ applied: 0, failed: 0, results: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const applied = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(JSON.stringify({ applied, failed, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * Update variant SKUs on a Wix product.
 * variantSkus: { [variantId]: sku } — use '__single__' key for single-variant products
 * where the variant ID isn't known upfront.
 */
async function applyVariantSkusToWix(
  _instanceId: string,
  productId: string,
  variantSkus: Record<string, string>,
): Promise<{ productId: string; success: boolean; error?: string }> {
  try {
    const { auth } = await import('@wix/essentials');
    const { productsV3 } = await import('@wix/stores');
    const elevatedUpdateProduct = auth.elevate(productsV3.updateProduct);

    // Fetch current product to get revision + full variant list
    const current = await productsV3.getProduct(productId) as any;
    const revision = current?.revision;
    if (!revision) {
      return { productId, success: false, error: 'Could not get product revision for SKU update' };
    }

    const rawVariants: any[] = current?.variantsInfo?.variants ?? [];
    if (rawVariants.length === 0) {
      return { productId, success: false, error: 'Product has no variants' };
    }

    const isSingleSentinel = '__single__' in variantSkus;
    let updatedVariants: any[];

    if (isSingleSentinel) {
      // Single-variant: update the first (and only) variant's SKU
      updatedVariants = rawVariants.map((v: any, i: number) =>
        i === 0 ? { ...v, sku: variantSkus['__single__'] } : v,
      );
    } else {
      // Multi-variant: patch only the matching variant IDs
      updatedVariants = rawVariants.map((v: any) => {
        const variantId = v._id ?? v.id;
        return variantId && variantSkus[variantId]
          ? { ...v, sku: variantSkus[variantId] }
          : v;
      });
    }

    await elevatedUpdateProduct(productId, {
      revision,
      variantsInfo: { variants: updatedVariants },
    } as any);

    return { productId, success: true };
  } catch (err: any) {
    const msg = err?.message ?? (typeof err === 'object' ? JSON.stringify(err).slice(0, 300) : String(err));
    return { productId, success: false, error: `SKU update failed: ${msg}` };
  }
}
