# Product Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Products workbench tab for browsing, filtering, previewing rules, AI enhancement, and syncing — plus convert Sync Status to a Dashboard landing tab.

**Architecture:** New `products_cache` Supabase table stores product snapshots. Four new API endpoints serve the workbench. The existing sync pipeline gets a `syncFromCache` variant that reads from the cache instead of live Wix SDK. The single-page dashboard (`sync-stream.tsx`) gets two new tab components: `DashboardTab` (relocated StatusTab) and `ProductsTab` (the workbench).

**Tech Stack:** TypeScript, Supabase (Postgres), Wix SDK, Wix Design System (Table, Checkbox, Badge, Tabs), existing sync pipeline.

**Spec:** `docs/superpowers/specs/2026-03-31-product-workbench-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260331_products_cache.sql` | products_cache table |
| `src/backend/productCache.ts` | Pull from Wix, read/write products_cache |
| `src/pages/api/products.ts` | GET cached products |
| `src/pages/api/products-pull.ts` | POST pull from Wix into cache |
| `src/pages/api/products-preview-rules.ts` | POST preview rules on cached products |
| `src/pages/api/products-sync.ts` | POST sync cached products through pipeline |
| `src/pages/api/products-enhance.ts` | POST AI enhance specific products |

### Modified Files
| File | Changes |
|------|---------|
| `src/backend/dataService.ts` | Add products_cache CRUD functions |
| `src/backend/syncService.ts` | Add `syncFromCache()` function |
| `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | Rename StatusTab→DashboardTab, add ProductsTab, update TAB_ITEMS |

---

## Task 1: Supabase Migration — products_cache

**Files:**
- Create: `supabase/migrations/20260331_products_cache.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260331_products_cache.sql
CREATE TABLE IF NOT EXISTS products_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  product_id text NOT NULL,
  name text NOT NULL,
  image_url text,
  price text,
  currency text DEFAULT 'USD',
  availability text,
  variant_count integer DEFAULT 1,
  description text,
  plain_description text,
  brand text,
  slug text,
  product_data jsonb NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, product_id)
);

CREATE INDEX idx_products_cache_instance ON products_cache(instance_id);
```

- [ ] **Step 2: Apply migration to Supabase**

Use Supabase MCP tool or run manually.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260331_products_cache.sql
git commit -m "feat: add products_cache Supabase migration"
```

---

## Task 2: dataService.ts — products_cache CRUD

**Files:**
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Add CachedProduct type and CRUD functions**

Add at the end of `src/backend/dataService.ts`:

```typescript
// ── Products Cache CRUD ──

export interface CachedProduct {
  id: string;
  instanceId: string;
  productId: string;
  name: string;
  imageUrl?: string;
  price?: string;
  currency: string;
  availability?: string;
  variantCount: number;
  description?: string;
  plainDescription?: string;
  brand?: string;
  slug?: string;
  productData: any; // Full WixProduct JSON
  cachedAt: string;
}

export async function upsertCachedProducts(
  instanceId: string,
  products: Omit<CachedProduct, 'id' | 'cachedAt'>[],
): Promise<number> {
  if (products.length === 0) return 0;
  const db = await getClient();
  const rows = products.map((p) => ({
    instance_id: instanceId,
    product_id: p.productId,
    name: p.name,
    image_url: p.imageUrl ?? null,
    price: p.price ?? null,
    currency: p.currency,
    availability: p.availability ?? null,
    variant_count: p.variantCount,
    description: p.description ?? null,
    plain_description: p.plainDescription ?? null,
    brand: p.brand ?? null,
    slug: p.slug ?? null,
    product_data: p.productData,
    cached_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from('products_cache')
    .upsert(rows, { onConflict: 'instance_id,product_id' });

  if (error) throw new Error(`Failed to cache products: ${error.message}`);
  return rows.length;
}

export async function getCachedProducts(instanceId: string): Promise<CachedProduct[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('products_cache')
    .select('*')
    .eq('instance_id', instanceId)
    .order('name', { ascending: true });

  if (error) throw new Error(`Failed to fetch cached products: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    productId: row.product_id,
    name: row.name,
    imageUrl: row.image_url ?? undefined,
    price: row.price ?? undefined,
    currency: row.currency,
    availability: row.availability ?? undefined,
    variantCount: row.variant_count,
    description: row.description ?? undefined,
    plainDescription: row.plain_description ?? undefined,
    brand: row.brand ?? undefined,
    slug: row.slug ?? undefined,
    productData: row.product_data,
    cachedAt: row.cached_at,
  }));
}

export async function getCachedProductsByIds(
  instanceId: string,
  productIds: string[],
): Promise<CachedProduct[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('products_cache')
    .select('*')
    .eq('instance_id', instanceId)
    .in('product_id', productIds);

  if (error) throw new Error(`Failed to fetch cached products: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    productId: row.product_id,
    name: row.name,
    imageUrl: row.image_url ?? undefined,
    price: row.price ?? undefined,
    currency: row.currency,
    availability: row.availability ?? undefined,
    variantCount: row.variant_count,
    description: row.description ?? undefined,
    plainDescription: row.plain_description ?? undefined,
    brand: row.brand ?? undefined,
    slug: row.slug ?? undefined,
    productData: row.product_data,
    cachedAt: row.cached_at,
  }));
}

export async function getProductsCacheTimestamp(instanceId: string): Promise<string | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('products_cache')
    .select('cached_at')
    .eq('instance_id', instanceId)
    .order('cached_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.cached_at;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/dataService.ts
git commit -m "feat: add products_cache CRUD to dataService"
```

---

## Task 3: productCache.ts — Pull Products from Wix

**Files:**
- Create: `src/backend/productCache.ts`

- [ ] **Step 1: Create productCache.ts**

```typescript
/**
 * productCache.ts
 *
 * Fetches products from the Wix SDK and caches them in Supabase.
 * The workbench reads from this cache instead of hitting Wix live.
 */

import type { WixProduct } from '../types/wix.types';
import { upsertCachedProducts, type CachedProduct } from './dataService';

/** Convert a Wix image URI to an HTTPS URL. */
function wixImageToUrl(wixImage: string | undefined): string {
  if (!wixImage) return '';
  if (wixImage.startsWith('http')) return wixImage;
  const match = wixImage.match(/wix:image:\/\/v1\/([^/]+)/);
  if (match) return `https://static.wixstatic.com/media/${match[1]}`;
  return '';
}

/** Extract a display price string from a WixProduct. */
function extractDisplayPrice(product: WixProduct): string {
  const amount =
    product.actualPriceRange?.minValue?.amount ??
    product.priceData?.price ??
    product.price?.price;
  if (amount == null) return '';
  return String(amount);
}

/** Map a WixProduct to a CachedProduct row (without id and cachedAt). */
function mapToCacheRow(product: WixProduct): Omit<CachedProduct, 'id' | 'cachedAt' | 'instanceId'> {
  const mainImage =
    (product.media?.main as any)?.image ??
    product.media?.main?.image?.url;

  return {
    productId: product._id ?? product.id,
    name: product.name,
    imageUrl: wixImageToUrl(mainImage),
    price: extractDisplayPrice(product),
    currency: product.currency ?? 'USD',
    availability: product.inventory?.availabilityStatus ?? 'IN_STOCK',
    variantCount: product.variantSummary?.variantCount ?? 1,
    description: product.description ?? undefined,
    plainDescription: product.plainDescription ?? undefined,
    brand: product.brand?.name ?? undefined,
    slug: product.slug,
    productData: product,
  };
}

/**
 * Pull all products from the Wix store and cache them in Supabase.
 * Returns the number of products cached.
 */
export async function pullProducts(instanceId: string): Promise<number> {
  const { productsV3 } = await import('@wix/stores');
  const products: WixProduct[] = [];
  let cursor: string | undefined;

  do {
    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 100, cursor } },
      {
        fields: [
          'URL',
          'CURRENCY',
          'PLAIN_DESCRIPTION',
          'MEDIA_ITEMS_INFO',
          'VARIANT_OPTION_CHOICE_NAMES',
        ],
      },
    );

    for (const p of response.products ?? []) {
      const product = p as any;
      const variantCount = product.variantSummary?.variantCount ?? 1;

      if (variantCount > 1) {
        try {
          const fullProduct = await productsV3.getProduct(
            product._id ?? product.id,
            {
              fields: [
                'URL',
                'CURRENCY',
                'PLAIN_DESCRIPTION',
                'MEDIA_ITEMS_INFO',
                'VARIANT_OPTION_CHOICE_NAMES',
              ],
            },
          );
          if (fullProduct) {
            products.push(fullProduct as unknown as WixProduct);
          }
        } catch {
          products.push(product as unknown as WixProduct);
        }
      } else {
        products.push(product as unknown as WixProduct);
      }
    }

    cursor = (response.pagingMetadata as any)?.cursors?.next ?? undefined;
  } while (cursor);

  const rows = products.map(mapToCacheRow);
  return upsertCachedProducts(instanceId, rows.map((r) => ({ ...r, instanceId })));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/productCache.ts
git commit -m "feat: add productCache module for Wix product caching"
```

---

## Task 4: syncService.ts — syncFromCache function

**Files:**
- Modify: `src/backend/syncService.ts`

- [ ] **Step 1: Add syncFromCache function**

Add at the end of `src/backend/syncService.ts`, before the closing of the file. Also add the needed import at the top:

**New import (add with existing imports):**
```typescript
import { getCachedProductsByIds } from './dataService';
```

**New function:**
```typescript
/**
 * Sync specific products from the products_cache through the full pipeline.
 * Used by the workbench to sync without re-fetching from Wix.
 */
export async function syncFromCache(
  instanceId: string,
  productIds: string[],
  platforms: SyncOptions['platforms'],
): Promise<BatchSyncResult> {
  const config = await getAppConfig(instanceId);
  if (!config) {
    throw new Error('App not configured. Please complete setup first.');
  }

  const cachedProducts = await getCachedProductsByIds(instanceId, productIds);
  if (cachedProducts.length === 0) {
    return { total: 0, synced: 0, failed: 0, results: [] };
  }

  // Reconstruct WixProduct objects from cached product_data JSON
  const products: WixProduct[] = cachedProducts.map((cp) => cp.productData as WixProduct);

  const results: SyncResult[] = [];

  if (platforms.includes('gmc')) {
    if (!config.gmcConnected) {
      throw new Error('GMC not connected. Please connect your account first.');
    }

    const accessToken = await getValidGmcAccessToken(instanceId);
    const tokens = await getGmcTokens(instanceId);
    const siteUrl = config.fieldMappings['siteUrl']?.defaultValue ?? '';

    // 2. Apply filters
    const filters = await getFilters(instanceId, 'gmc');
    const filtered = applyFilters(products, filters, 'gmc');

    // 3. Flatten variants
    const flattened = filtered.flatMap((p) => flattenVariants(p));

    // 4. AI enhance (if enabled)
    let enhancedMap: Map<string, { title: string; description: string }> | undefined;
    if (config.aiEnhancementEnabled) {
      const uniqueProducts = [...new Map(filtered.map((p) => [p._id ?? p.id, p])).values()];
      enhancedMap = await enhanceProducts(uniqueProducts, instanceId, config.aiEnhancementStyle);
    }

    // 5. Map + 6. Apply rules
    const rules = await getRules(instanceId, 'gmc');
    const validProducts: GmcProductInput[] = [];
    const validationFailures: SyncResult[] = [];

    for (const item of flattened) {
      const productId = item.product._id ?? item.product.id;
      const enhanced = enhancedMap?.get(productId);
      const gmcProduct = mapFlattenedToGmc(item, config.fieldMappings, siteUrl, enhanced);
      const transformed = applyRules([gmcProduct], rules, 'gmc');
      const errors = validateGmc(transformed[0], transformed[0].offerId);

      if (errors.length > 0) {
        validationFailures.push({
          productId: transformed[0].offerId,
          platform: 'gmc',
          success: false,
          errors,
        });
      } else {
        validProducts.push(transformed[0]);
      }
    }

    results.push(...validationFailures);

    if (validProducts.length > 0) {
      const batchResults = await batchInsertProducts(
        tokens.merchantId,
        config.gmcDataSourceId ?? '',
        validProducts,
        accessToken,
      );

      for (const result of batchResults) {
        if (result.success) {
          results.push({
            productId: result.offerId,
            platform: 'gmc',
            success: true,
            externalId: result.name,
          });
        } else {
          results.push({
            productId: result.offerId,
            platform: 'gmc',
            success: false,
            errors: [{
              field: 'api',
              platform: 'gmc' as const,
              message: result.error ?? 'Unknown error',
              productId: result.offerId,
            }],
          });
        }
      }
    }
  }

  // Write SyncState records
  const syncStates: SyncState[] = results.map((r) => ({
    productId: r.productId,
    platform: r.platform,
    status: r.success ? 'synced' as const : 'error' as const,
    lastSynced: new Date(),
    errorLog: r.errors ?? null,
    externalId: r.externalId ?? '',
  }));

  await bulkUpsertSyncStates(syncStates);

  const synced = results.filter((r) => r.success).length;
  return {
    total: results.length,
    synced,
    failed: results.length - synced,
    results,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/syncService.ts
git commit -m "feat: add syncFromCache for workbench-driven sync"
```

---

## Task 5: API Endpoints — Products

**Files:**
- Create: `src/pages/api/products.ts`
- Create: `src/pages/api/products-pull.ts`
- Create: `src/pages/api/products-preview-rules.ts`
- Create: `src/pages/api/products-sync.ts`
- Create: `src/pages/api/products-enhance.ts`

- [ ] **Step 1: Create GET /api/products**

```typescript
// src/pages/api/products.ts
import type { APIRoute } from 'astro';
import { getCachedProducts, getProductsCacheTimestamp, querySyncStates } from '../../backend/dataService';
import { getBulkEnhancedContent } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? 'default';

    const [products, cacheTimestamp, syncStates] = await Promise.all([
      getCachedProducts(instanceId),
      getProductsCacheTimestamp(instanceId),
      querySyncStates(500),
    ]);

    // Build sync status map
    const syncMap = new Map<string, { status: string; lastSynced: string }>();
    for (const s of syncStates) {
      syncMap.set(s.productId, { status: s.status, lastSynced: s.lastSynced.toISOString() });
    }

    // Build enhanced content map
    const productIds = products.map((p) => p.productId);
    const enhancedMap = productIds.length > 0
      ? await getBulkEnhancedContent(instanceId, productIds)
      : new Map();

    const enriched = products.map((p) => ({
      ...p,
      syncStatus: syncMap.get(p.productId) ?? null,
      enhancedDescription: enhancedMap.get(p.productId)?.enhancedDescription ?? null,
      enhancedTitle: enhancedMap.get(p.productId)?.enhancedTitle ?? null,
    }));

    return new Response(JSON.stringify({
      products: enriched,
      cachedAt: cacheTimestamp,
      count: enriched.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Create POST /api/products-pull**

```typescript
// src/pages/api/products-pull.ts
import type { APIRoute } from 'astro';
import { pullProducts } from '../../backend/productCache';
import { getProductsCacheTimestamp } from '../../backend/dataService';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';

    const count = await pullProducts(instanceId);
    const cachedAt = await getProductsCacheTimestamp(instanceId);

    return new Response(JSON.stringify({ success: true, count, cachedAt }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 3: Create POST /api/products-preview-rules**

```typescript
// src/pages/api/products-preview-rules.ts
import type { APIRoute } from 'astro';
import { getCachedProductsByIds, getAppConfig, getRules } from '../../backend/dataService';
import { flattenVariants, mapFlattenedToGmc } from '../../backend/productMapper';
import { applyRules } from '../../backend/rulesEngine';
import type { WixProduct } from '../../types/wix.types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';
    const productIds: string[] = body.productIds ?? [];

    const config = await getAppConfig(instanceId);
    if (!config) {
      return new Response(JSON.stringify({ error: 'App not configured' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cached = await getCachedProductsByIds(instanceId, productIds);
    const rules = await getRules(instanceId, 'gmc');
    const siteUrl = config.fieldMappings['siteUrl']?.defaultValue ?? '';

    const previews = cached.map((cp) => {
      const product = cp.productData as WixProduct;
      const flattened = flattenVariants(product);
      const firstItem = flattened[0];
      const original = mapFlattenedToGmc(firstItem, config.fieldMappings, siteUrl);
      const transformed = applyRules([{ ...original, productAttributes: { ...original.productAttributes } }], rules, 'gmc');

      return {
        productId: cp.productId,
        original: {
          title: original.productAttributes.title,
          description: original.productAttributes.description,
          price: original.productAttributes.price,
          brand: original.productAttributes.brand,
        },
        transformed: {
          title: transformed[0].productAttributes.title,
          description: transformed[0].productAttributes.description,
          price: transformed[0].productAttributes.price,
          brand: transformed[0].productAttributes.brand,
        },
      };
    });

    return new Response(JSON.stringify({ previews }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 4: Create POST /api/products-sync**

```typescript
// src/pages/api/products-sync.ts
import type { APIRoute } from 'astro';
import { syncFromCache } from '../../backend/syncService';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';
    const productIds: string[] = body.productIds ?? [];
    const platforms = body.platforms ?? ['gmc'];

    if (productIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No product IDs provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await syncFromCache(instanceId, productIds, platforms);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 5: Create POST /api/products-enhance**

```typescript
// src/pages/api/products-enhance.ts
import type { APIRoute } from 'astro';
import { getCachedProductsByIds, getAppConfig } from '../../backend/dataService';
import { enhanceProduct, enhanceProducts } from '../../backend/aiEnhancer';
import type { WixProduct } from '../../types/wix.types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';
    const productIds: string[] = body.productIds
      ? body.productIds
      : body.productId
        ? [body.productId]
        : [];

    if (productIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No product IDs provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const config = await getAppConfig(instanceId);
    const cached = await getCachedProductsByIds(instanceId, productIds);
    const products = cached.map((cp) => cp.productData as WixProduct);

    const results = await enhanceProducts(products, instanceId, config?.aiEnhancementStyle);

    const enhanced = Array.from(results.entries()).map(([pid, content]) => ({
      productId: pid,
      title: content.title,
      description: content.description,
    }));

    return new Response(JSON.stringify({ success: true, enhanced, count: enhanced.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/products.ts src/pages/api/products-pull.ts src/pages/api/products-preview-rules.ts src/pages/api/products-sync.ts src/pages/api/products-enhance.ts
git commit -m "feat: add API endpoints for product workbench"
```

---

## Task 6: Dashboard — Rename StatusTab to DashboardTab, Update Tabs

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

- [ ] **Step 1: Update TAB_ITEMS**

Replace the existing `TAB_ITEMS` constant (around line 704 area):

```typescript
const TAB_ITEMS = [
  { id: 'connect', title: 'Connect' },
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'products', title: 'Products' },
  { id: 'mapping', title: 'Field Mapping' },
  { id: 'settings', title: 'Settings' },
];
```

- [ ] **Step 2: Rename StatusTab to DashboardTab**

Find `const StatusTab: FC = ()` and rename to `const DashboardTab: FC = ()`. No changes to the internal logic — it already shows summary cards, sync records, and a Sync Now button.

- [ ] **Step 3: Update default activeTab and tab rendering**

Change the default state from `'connect'` to `'dashboard'`:
```typescript
const [activeTab, setActiveTab] = useState('dashboard');
```

Update the rendering section to replace `'status'` with `'dashboard'` and add `'products'`:
```typescript
{activeTab === 'connect' && <ConnectTab config={config} onRefresh={loadConfig} />}
{activeTab === 'dashboard' && <DashboardTab />}
{activeTab === 'products' && <ProductsTab />}
{activeTab === 'mapping' && <MappingTab config={config} />}
{activeTab === 'settings' && <SettingsTab config={config} onRefresh={loadConfig} />}
```

- [ ] **Step 4: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: rename StatusTab to DashboardTab, update tab order"
```

---

## Task 7: ProductsTab Component — Workbench UI

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

This is the largest task. Add the `ProductsTab` component before the `DashboardTab` in `sync-stream.tsx`.

- [ ] **Step 1: Add ProductsTab component**

Add this component in `sync-stream.tsx` before the DashboardTab component:

```typescript
// ─── Products Tab (Workbench) ───────────────────────────────────────────

interface CachedProductRow {
  productId: string;
  name: string;
  imageUrl?: string;
  price?: string;
  currency: string;
  availability?: string;
  variantCount: number;
  description?: string;
  plainDescription?: string;
  brand?: string;
  syncStatus: { status: string; lastSynced: string } | null;
  enhancedDescription: string | null;
  enhancedTitle: string | null;
}

const FILTER_FIELD_OPTIONS = [
  { id: 'name', value: 'Name' },
  { id: 'price', value: 'Price' },
  { id: 'availability', value: 'Availability' },
  { id: 'brand', value: 'Brand' },
  { id: 'variantCount', value: 'Variants' },
  { id: 'description', value: 'Description' },
];

const FILTER_OPERATOR_OPTIONS = [
  { id: 'equals', value: 'Equals' },
  { id: 'not_equals', value: 'Not Equals' },
  { id: 'contains', value: 'Contains' },
  { id: 'greater_than', value: 'Greater Than' },
  { id: 'less_than', value: 'Less Than' },
];

function applyClientFilter(
  products: CachedProductRow[],
  field: string,
  operator: string,
  value: string,
): CachedProductRow[] {
  return products.filter((p) => {
    const fieldValue = String((p as any)[field] ?? '');
    const numField = Number(fieldValue);
    const numValue = Number(value);

    switch (operator) {
      case 'equals': return fieldValue === value;
      case 'not_equals': return fieldValue !== value;
      case 'contains': return fieldValue.toLowerCase().includes(value.toLowerCase());
      case 'greater_than': return !isNaN(numField) && !isNaN(numValue) && numField > numValue;
      case 'less_than': return !isNaN(numField) && !isNaN(numValue) && numField < numValue;
      default: return true;
    }
  });
}

const ProductsTab: FC = () => {
  const [products, setProducts] = useState<CachedProductRow[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<CachedProductRow[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enhancing, setEnhancing] = useState<string | null>(null); // productId being enhanced, or 'bulk'
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filter state
  const [filterField, setFilterField] = useState('name');
  const [filterOperator, setFilterOperator] = useState('contains');
  const [filterValue, setFilterValue] = useState('');
  const [activeFilter, setActiveFilter] = useState<{ field: string; operator: string; value: string } | null>(null);

  // Rules preview state
  const [previewData, setPreviewData] = useState<Map<string, { original: any; transformed: any }> | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await appFetch('/api/products?instanceId=default');
      const data = await response.json();
      setProducts(data.products ?? []);
      setFilteredProducts(data.products ?? []);
      setCachedAt(data.cachedAt);
    } catch {
      // empty cache
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await appFetch('/api/products-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default' }),
      });
      const data = await response.json();
      setSuccess(`Pulled ${data.count} products from your store.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull products');
    } finally {
      setPulling(false);
    }
  }, [loadProducts]);

  const handlePreviewFilter = useCallback(() => {
    if (!filterValue.trim()) {
      setFilteredProducts(products);
      setActiveFilter(null);
      return;
    }
    const result = applyClientFilter(products, filterField, filterOperator, filterValue);
    setFilteredProducts(result);
    setActiveFilter({ field: filterField, operator: filterOperator, value: filterValue });
  }, [products, filterField, filterOperator, filterValue]);

  const handleClearFilter = useCallback(() => {
    setFilteredProducts(products);
    setActiveFilter(null);
    setFilterValue('');
  }, [products]);

  const handlePinFilter = useCallback(async () => {
    if (!activeFilter) return;
    try {
      await appFetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'default',
          name: `${activeFilter.field} ${activeFilter.operator} "${activeFilter.value}"`,
          platform: 'both',
          field: activeFilter.field,
          operator: activeFilter.operator,
          value: activeFilter.value,
          conditionGroup: 'AND',
          order: 0,
          enabled: true,
        }),
      });
      setSuccess('Filter pinned — it will apply during sync.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pin filter');
    }
  }, [activeFilter]);

  const handlePreviewRules = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    try {
      const ids = filteredProducts.map((p) => p.productId);
      const response = await appFetch('/api/products-preview-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: ids }),
      });
      const data = await response.json();
      const map = new Map<string, any>();
      for (const p of data.previews ?? []) {
        map.set(p.productId, p);
      }
      setPreviewData(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview rules');
    } finally {
      setPreviewing(false);
    }
  }, [filteredProducts]);

  const handleEnhanceOne = useCallback(async (productId: string) => {
    setEnhancing(productId);
    setError(null);
    try {
      await appFetch('/api/products-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productId }),
      });
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally {
      setEnhancing(null);
    }
  }, [loadProducts]);

  const handleEnhanceBulk = useCallback(async () => {
    if (selected.size === 0) return;
    setEnhancing('bulk');
    setError(null);
    try {
      const response = await appFetch('/api/products-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: Array.from(selected) }),
      });
      const data = await response.json();
      setSuccess(`Enhanced ${data.count} products.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk enhancement failed');
    } finally {
      setEnhancing(null);
    }
  }, [selected, loadProducts]);

  const handleSyncProducts = useCallback(async () => {
    const ids = selected.size > 0 ? Array.from(selected) : filteredProducts.map((p) => p.productId);
    if (ids.length === 0) return;
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await appFetch('/api/products-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: ids, platforms: ['gmc'] }),
      });
      const data = await response.json();
      setSuccess(`Sync complete: ${data.synced} synced, ${data.failed} failed out of ${data.total}.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [selected, filteredProducts, loadProducts]);

  const toggleSelect = useCallback((productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filteredProducts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredProducts.map((p) => p.productId)));
    }
  }, [selected, filteredProducts]);

  if (loading) {
    return <Box align="center" padding="60px"><Loader /></Box>;
  }

  return (
    <Box direction="vertical" gap="18px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">{success}</SectionHelper>}

      {/* Toolbar */}
      <Box gap="12px" verticalAlign="middle">
        <Button size="small" onClick={handlePull} disabled={pulling}>
          {pulling ? 'Pulling...' : 'Pull Products'}
        </Button>
        {cachedAt && (
          <Text size="tiny" secondary>
            Last refreshed: {new Date(cachedAt).toLocaleString()}
          </Text>
        )}
        <Box marginLeft="auto" gap="12px">
          {selected.size > 0 && (
            <Button size="small" onClick={handleEnhanceBulk} disabled={enhancing === 'bulk'}>
              {enhancing === 'bulk' ? 'Enhancing...' : `Generate AI (${selected.size})`}
            </Button>
          )}
          <Button size="small" onClick={handlePreviewRules} disabled={previewing || products.length === 0}>
            {previewing ? 'Loading...' : previewData ? 'Clear Preview' : 'Preview Rules'}
          </Button>
          <Button size="small" skin="dark" onClick={handleSyncProducts} disabled={syncing || products.length === 0}>
            {syncing ? 'Syncing...' : `Sync ${selected.size > 0 ? selected.size : filteredProducts.length} Products`}
          </Button>
        </Box>
      </Box>

      {/* Filter bar */}
      <Card>
        <Card.Content>
          <Box gap="12px" verticalAlign="bottom">
            <Box width="150px">
              <FormField label="Field">
                <Dropdown size="small" options={FILTER_FIELD_OPTIONS} selectedId={filterField} onSelect={(o) => setFilterField(o.id as string)} />
              </FormField>
            </Box>
            <Box width="150px">
              <FormField label="Operator">
                <Dropdown size="small" options={FILTER_OPERATOR_OPTIONS} selectedId={filterOperator} onSelect={(o) => setFilterOperator(o.id as string)} />
              </FormField>
            </Box>
            <Box width="200px">
              <FormField label="Value">
                <Input size="small" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="Filter value..." />
              </FormField>
            </Box>
            <Button size="small" onClick={handlePreviewFilter}>Preview</Button>
            {activeFilter && (
              <>
                <Button size="small" skin="light" onClick={handlePinFilter}>Pin Filter</Button>
                <Button size="small" skin="light" onClick={handleClearFilter}>Clear</Button>
              </>
            )}
          </Box>
          {activeFilter && (
            <Box marginTop="6px">
              <Badge size="small" skin="general">
                {activeFilter.field} {activeFilter.operator} &quot;{activeFilter.value}&quot;
              </Badge>
            </Box>
          )}
        </Card.Content>
      </Card>

      {/* Empty state */}
      {products.length === 0 && (
        <Card>
          <Card.Content>
            <Box direction="vertical" align="center" padding="48px" gap="12px">
              <Text weight="bold">No products loaded</Text>
              <Text size="small" secondary>Click &quot;Pull Products&quot; to fetch your store catalog.</Text>
            </Box>
          </Card.Content>
        </Card>
      )}

      {/* Product table */}
      {filteredProducts.length > 0 && (
        <Card>
          <Table
            data={filteredProducts}
            columns={[
              {
                title: (
                  <input
                    type="checkbox"
                    checked={selected.size === filteredProducts.length && filteredProducts.length > 0}
                    onChange={toggleSelectAll}
                  />
                ) as any,
                render: (row: CachedProductRow) => (
                  <input
                    type="checkbox"
                    checked={selected.has(row.productId)}
                    onChange={() => toggleSelect(row.productId)}
                  />
                ),
                width: '40px',
              },
              {
                title: 'Image',
                render: (row: CachedProductRow) =>
                  row.imageUrl ? (
                    <img src={row.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <Box width="40px" height="40px" backgroundColor="#f0f0f0" borderRadius="4px" />
                  ),
                width: '60px',
              },
              {
                title: 'Title',
                render: (row: CachedProductRow) => {
                  const preview = previewData?.get(row.productId);
                  if (preview && preview.original.title !== preview.transformed.title) {
                    return (
                      <Box direction="vertical">
                        <Text size="small" style={{ textDecoration: 'line-through' }}>{preview.original.title}</Text>
                        <Text size="small" skin="success">{preview.transformed.title}</Text>
                      </Box>
                    );
                  }
                  return <Text size="small">{row.name}</Text>;
                },
                width: '20%',
              },
              {
                title: 'Price',
                render: (row: CachedProductRow) => (
                  <Text size="small">{row.price ? `$${row.price}` : '—'}</Text>
                ),
                width: '80px',
              },
              {
                title: 'Status',
                render: (row: CachedProductRow) => {
                  const avail = row.availability ?? 'IN_STOCK';
                  return (
                    <Badge size="small" skin={avail === 'IN_STOCK' ? 'success' : 'danger'}>
                      {avail === 'IN_STOCK' ? 'In Stock' : 'Out of Stock'}
                    </Badge>
                  );
                },
                width: '100px',
              },
              {
                title: 'Variants',
                render: (row: CachedProductRow) => <Text size="small">{row.variantCount}</Text>,
                width: '60px',
              },
              {
                title: 'Description',
                render: (row: CachedProductRow) => (
                  <Text size="tiny" secondary style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.plainDescription ?? row.description ?? '—'}
                  </Text>
                ),
                width: '20%',
              },
              {
                title: 'AI Description',
                render: (row: CachedProductRow) => (
                  <Text size="tiny" skin={row.enhancedDescription ? 'success' : 'disabled'} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.enhancedDescription ?? '—'}
                  </Text>
                ),
                width: '20%',
              },
              {
                title: 'Sync',
                render: (row: CachedProductRow) => {
                  if (!row.syncStatus) return <Text size="tiny" secondary>—</Text>;
                  const skin = row.syncStatus.status === 'synced' ? 'success' : row.syncStatus.status === 'error' ? 'danger' : 'warning';
                  return <Badge size="small" skin={skin}>{row.syncStatus.status}</Badge>;
                },
                width: '80px',
              },
              {
                title: '',
                render: (row: CachedProductRow) => (
                  <Button
                    size="tiny"
                    skin="light"
                    onClick={() => handleEnhanceOne(row.productId)}
                    disabled={enhancing === row.productId}
                  >
                    {enhancing === row.productId ? '...' : 'AI'}
                  </Button>
                ),
                width: '50px',
              },
            ]}
          >
            <TableToolbar>
              <TableToolbar.Title>
                {filteredProducts.length} products{activeFilter ? ' (filtered)' : ''}
                {selected.size > 0 ? ` · ${selected.size} selected` : ''}
              </TableToolbar.Title>
            </TableToolbar>
            <Table.Content />
          </Table>
        </Card>
      )}
    </Box>
  );
};
```

- [ ] **Step 2: Verify the Preview Rules toggle works**

The "Preview Rules" button should toggle `previewData` on/off. Update the click handler:

In the toolbar, the Preview Rules button's `onClick` should be:
```typescript
onClick={() => {
  if (previewData) {
    setPreviewData(null);
  } else {
    handlePreviewRules();
  }
}}
```

- [ ] **Step 3: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: add ProductsTab workbench with filtering, rules preview, AI enhance, and sync"
```

---

## Task 8: Integration Verification

- [ ] **Step 1: TypeScript compilation check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Build check**

```bash
npx wix build
```

Fix any build errors.

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve compilation errors from product workbench"
```

- [ ] **Step 4: Deploy**

```bash
npx wix release
```
