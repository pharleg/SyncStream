# Post-Architecture Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four post-architecture features: SKU-based IDs, standalone compliance checks with health scores, per-product platform targeting, and product images in the workbench.

**Architecture:** Each feature builds on the existing pipeline (syncService → productMapper → validator → gmcClient) and Supabase data layer. SKU handling and compliance checks are backend-first; platform targeting requires a schema migration + backend + UI; product images are already partially implemented (imageUrl exists in workbench rows).

**Tech Stack:** TypeScript, Wix Stores V3 SDK, Supabase (Postgres), Wix Design System (@wix/design-system), existing pipeline in `src/backend/`

---

## File Structure

### New files
- `supabase/migrations/20260402_platform_targeting.sql` — adds `platforms` column to `sync_state`
- `src/pages/api/compliance-check.ts` — standalone compliance check endpoint

### Modified files
- `src/types/wix.types.ts` — add `severity` to `ValidationError`, add `platforms` to `SyncState`
- `src/types/sync.types.ts` — add `ComplianceResult` type
- `src/backend/validator.ts` — add warning severity, SKU checks, standalone compliance function
- `src/backend/productMapper.ts` — SKU-first ID generation
- `src/backend/syncService.ts` — fix `options.platforms` bug, check per-product platforms
- `src/backend/dataService.ts` — CRUD for product `platforms`, compliance query helpers
- `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` — compliance health score card, platform toggles per product, image verification column

---

## Task 1: Add warning severity to ValidationError

**Files:**
- Modify: `src/types/wix.types.ts:130-135`
- Modify: `src/backend/validator.ts:13-27`

- [ ] **Step 1: Add `severity` field to ValidationError type**

In `src/types/wix.types.ts`, update the `ValidationError` interface:

```typescript
export interface ValidationError {
  field: string;
  platform: 'gmc' | 'meta';
  message: string;
  productId: string;
  severity: 'error' | 'warning';
}
```

- [ ] **Step 2: Update `requiredString` helper to accept severity**

In `src/backend/validator.ts`, update the helper:

```typescript
function requiredString(
  value: string | undefined,
  field: string,
  productId: string,
  severity: 'error' | 'warning' = 'error',
): ValidationError | null {
  if (!value || value.trim().length === 0) {
    return {
      field,
      platform: 'gmc',
      message: `${field} is required and must not be empty`,
      productId,
      severity,
    };
  }
  return null;
}
```

- [ ] **Step 3: Add `severity: 'error'` to all existing error pushes in `validateGmc`**

Every `errors.push({ ... })` call in `validateGmc` (lines 60-128) needs `severity: 'error'` added. There are 7 push sites: availability (line 60), condition (line 69), price.amountMicros (line 82), price.currencyCode (line 92), description length (line 101), link URL (line 111), imageLink URL (line 121).

Example for the availability check at line 59:

```typescript
  if (!['IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'BACKORDER'].includes(attrs.availability)) {
    errors.push({
      field: 'availability',
      platform: 'gmc',
      message: `availability must be "IN_STOCK", "OUT_OF_STOCK", "PREORDER", or "BACKORDER", got "${attrs.availability}"`,
      productId,
      severity: 'error',
    });
  }
```

Apply the same pattern to all 7 push sites.

- [ ] **Step 4: Commit**

```bash
git add src/types/wix.types.ts src/backend/validator.ts
git commit -m "feat: add warning/error severity to ValidationError"
```

---

## Task 2: SKU-based ID generation in productMapper

**Files:**
- Modify: `src/backend/productMapper.ts:218-227,293-294`
- Modify: `src/backend/validator.ts:29-56`

- [ ] **Step 1: Update `flattenVariants` to extract SKU into `FlattenedProduct`**

In `src/types/wix.types.ts`, add `sku` to `FlattenedProduct`:

```typescript
export interface FlattenedProduct {
  product: WixProduct;
  variant?: WixVariant;
  parentId: string;
  itemId: string;
  sku?: string;
  isMultiVariant: boolean;
}
```

- [ ] **Step 2: Update `flattenVariants` in productMapper.ts to populate SKU**

In `src/backend/productMapper.ts`, update the multi-variant return at line 220 and single-variant return at line 210:

For multi-variant (line 220):
```typescript
  return variants.map((variant) => ({
    product,
    variant,
    parentId,
    itemId: variant._id ?? variant.id,
    sku: variant.sku || undefined,
    isMultiVariant: true,
  }));
```

For single-variant (around line 210, the else branch):
```typescript
  return [{
    product,
    variant: variants[0],
    parentId,
    itemId: variants[0]?._id ?? variants[0]?.id ?? parentId,
    sku: variants[0]?.sku || undefined,
    isMultiVariant: false,
  }];
```

- [ ] **Step 3: Use SKU as offerId when available in `mapFlattenedToGmc`**

In `src/backend/productMapper.ts`, update line 294:

```typescript
  // SKU-first ID: use SKU if present, otherwise fallback to parentId_variantId
  const offerId = item.sku
    ? item.sku
    : item.isMultiVariant
      ? `${item.parentId}_${item.itemId}`
      : item.itemId;

  return {
    offerId,
    contentLanguage: 'en',
    feedLabel: 'US',
    productAttributes,
  };
```

- [ ] **Step 4: Add SKU warning in validator**

In `src/backend/validator.ts`, add a warning check after the existing `offerId` validation (after line 56):

```typescript
  // SKU warning: if offerId looks like a fallback (contains underscore or matches UUID pattern), warn
  if (product.offerId && !product.offerId.includes('_') === false) {
    // Check if offerId is NOT a real SKU (heuristic: UUIDs or underscore-joined IDs)
    const looksLikeFallback = product.offerId.includes('_') ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(product.offerId);
    if (looksLikeFallback) {
      errors.push({
        field: 'offerId',
        platform: 'gmc',
        message: 'No SKU set — using generated fallback ID. Set a SKU on this product/variant for stable GMC tracking.',
        productId,
        severity: 'warning',
      });
    }
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/types/wix.types.ts src/backend/productMapper.ts src/backend/validator.ts
git commit -m "feat: SKU-first ID generation with missing-SKU warnings"
```

---

## Task 3: Standalone compliance check endpoint

**Files:**
- Modify: `src/types/sync.types.ts`
- Create: `src/pages/api/compliance-check.ts`
- Modify: `src/backend/validator.ts` (add `runComplianceCheck` export)
- Modify: `src/backend/dataService.ts` (add `getComplianceSummary`)

- [ ] **Step 1: Add ComplianceResult types**

In `src/types/sync.types.ts`, add:

```typescript
export interface ProductComplianceResult {
  productId: string;
  offerId: string;
  errors: import('./wix.types').ValidationError[];
  warnings: import('./wix.types').ValidationError[];
  compliant: boolean;
}

export interface ComplianceSummary {
  totalProducts: number;
  compliantCount: number;
  warningCount: number;
  errorCount: number;
  healthScore: number; // 0-100, percentage compliant
  results: ProductComplianceResult[];
}
```

- [ ] **Step 2: Add `runComplianceCheck` to validator.ts**

Append to `src/backend/validator.ts`:

```typescript
import type { FlattenedProduct, FieldMappings } from '../types/wix.types';
import type { ProductComplianceResult, ComplianceSummary } from '../types/sync.types';
import { flattenVariants, mapFlattenedToGmc } from './productMapper';
import { applyRules } from './rulesEngine';
import { getRules, getFilters, getAppConfig } from './dataService';
import { applyFilters } from './filterEngine';

/**
 * Run compliance validation on products without triggering a sync.
 * Returns per-product results and an overall health score.
 */
export async function runComplianceCheck(
  instanceId: string,
  products: import('../types/wix.types').WixProduct[],
  platform: 'gmc' | 'meta' = 'gmc',
): Promise<ComplianceSummary> {
  const config = await getAppConfig(instanceId);
  const mappings = config?.fieldMappings ?? {};
  const siteUrl = mappings['siteUrl']?.defaultValue ?? '';
  const filters = await getFilters(instanceId, platform);
  const filtered = applyFilters(products, filters, platform);
  const flattened = filtered.flatMap((p) => flattenVariants(p));
  const rules = await getRules(instanceId, platform);

  const results: ProductComplianceResult[] = [];

  for (const item of flattened) {
    if (platform === 'gmc') {
      const gmcProduct = mapFlattenedToGmc(item, mappings, siteUrl);
      const transformed = applyRules([gmcProduct], rules, platform);
      const allIssues = validateGmc(transformed[0], transformed[0].offerId);
      const errors = allIssues.filter((e) => e.severity === 'error');
      const warnings = allIssues.filter((e) => e.severity === 'warning');
      results.push({
        productId: item.product._id ?? item.product.id,
        offerId: transformed[0].offerId,
        errors,
        warnings,
        compliant: errors.length === 0,
      });
    }
    // Meta validation added in Phase 4
  }

  const compliantCount = results.filter((r) => r.compliant).length;
  const warningCount = results.filter((r) => r.warnings.length > 0).length;
  const errorCount = results.filter((r) => !r.compliant).length;
  const healthScore = results.length > 0
    ? Math.round((compliantCount / results.length) * 100)
    : 100;

  return {
    totalProducts: results.length,
    compliantCount,
    warningCount,
    errorCount,
    healthScore,
    results,
  };
}
```

- [ ] **Step 3: Create the compliance-check API endpoint**

Create `src/pages/api/compliance-check.ts`:

```typescript
import { getAppConfig, getCachedProductsByIds } from '../../backend/dataService';
import { runComplianceCheck } from '../../backend/validator';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const instanceId: string = body.instanceId ?? 'default';
    const platform: 'gmc' | 'meta' = body.platform ?? 'gmc';
    const productIds: string[] | undefined = body.productIds;

    let products;
    if (productIds && productIds.length > 0) {
      products = await getCachedProductsByIds(instanceId, productIds);
    } else {
      // Check all cached products
      products = await getCachedProductsByIds(instanceId);
    }

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({
        error: 'No products found. Pull products first.',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const summary = await runComplianceCheck(instanceId, products, platform);

    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compliance check failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/sync.types.ts src/backend/validator.ts src/pages/api/compliance-check.ts
git commit -m "feat: standalone compliance check endpoint with health score"
```

---

## Task 4: Per-product platform targeting — schema + backend

**Files:**
- Create: `supabase/migrations/20260402_platform_targeting.sql`
- Modify: `src/types/wix.types.ts:120-128`
- Modify: `src/backend/dataService.ts`
- Modify: `src/backend/syncService.ts:147-159`

- [ ] **Step 1: Create migration to add `platforms` column**

Create `supabase/migrations/20260402_platform_targeting.sql`:

```sql
-- Add per-product platform targeting
-- Default to all platforms (null = sync to all connected platforms)
ALTER TABLE sync_state ADD COLUMN platforms TEXT[] DEFAULT NULL;

-- Index for filtering by platform targeting
CREATE INDEX idx_sync_state_platforms ON sync_state USING GIN (platforms);

COMMENT ON COLUMN sync_state.platforms IS
  'Platforms this product should sync to. NULL = all connected platforms. e.g. {gmc,meta}';
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Or run the SQL directly via the Supabase dashboard if using remote.

- [ ] **Step 3: Update SyncState type**

In `src/types/wix.types.ts`, update the `SyncState` interface:

```typescript
export interface SyncState {
  productId: string;
  platform: 'gmc' | 'meta';
  status: 'synced' | 'error' | 'pending';
  lastSynced: Date;
  errorLog: ValidationError[] | null;
  externalId: string;
  /** Platforms this product should sync to. null = all connected. */
  platforms?: ('gmc' | 'meta')[] | null;
}
```

- [ ] **Step 4: Add platform targeting CRUD in dataService**

Append to `src/backend/dataService.ts`:

```typescript
/**
 * Get the target platforms for a specific product.
 * Returns null if no targeting set (= sync to all connected).
 */
export async function getProductPlatforms(
  productId: string,
): Promise<('gmc' | 'meta')[] | null> {
  const db = await getClient();
  const { data } = await db
    .from('sync_state')
    .select('platforms')
    .eq('product_id', productId)
    .limit(1)
    .single();
  return data?.platforms ?? null;
}

/**
 * Set the target platforms for one or more products.
 * Pass null to reset to "all connected platforms".
 */
export async function setProductPlatforms(
  productIds: string[],
  platforms: ('gmc' | 'meta')[] | null,
): Promise<void> {
  const db = await getClient();
  // Upsert: for each product, update platforms on existing rows or insert a placeholder
  for (const productId of productIds) {
    await db
      .from('sync_state')
      .upsert(
        { product_id: productId, platform: 'gmc', status: 'pending', platforms },
        { onConflict: 'product_id,platform' },
      );
  }
}

/**
 * Get platforms map for a batch of product IDs.
 * Returns Map<productId, platforms[]|null>.
 */
export async function getBatchProductPlatforms(
  productIds: string[],
): Promise<Map<string, ('gmc' | 'meta')[] | null>> {
  const db = await getClient();
  const { data } = await db
    .from('sync_state')
    .select('product_id, platforms')
    .in('product_id', productIds);

  const map = new Map<string, ('gmc' | 'meta')[] | null>();
  for (const row of data ?? []) {
    if (!map.has(row.product_id)) {
      map.set(row.product_id, row.platforms ?? null);
    }
  }
  return map;
}
```

- [ ] **Step 5: Fix the `options.platforms` bug and add per-product filtering in syncService**

In `src/backend/syncService.ts`, fix line 159 — change `options.platforms` to `platforms`:

```typescript
  if (platforms.includes('gmc')) {
```

Then, after the `applyFilters` call (line 172) and before flattening, add per-product platform filtering:

```typescript
    // 2. Apply filters
    const filters = await getFilters(instanceId, 'gmc');
    const filtered = applyFilters(products, filters, 'gmc');

    // 2b. Per-product platform targeting — skip products not targeting GMC
    const productIds = filtered.map((p) => p._id ?? p.id);
    const platformMap = await getBatchProductPlatforms(productIds);
    const platformFiltered = filtered.filter((p) => {
      const id = p._id ?? p.id;
      const targets = platformMap.get(id);
      // null = all platforms, otherwise check if 'gmc' is included
      return targets === null || targets === undefined || targets.includes('gmc');
    });

    // 3. Flatten variants
    const flattened = platformFiltered.flatMap((p) => flattenVariants(p));
```

Add the import at the top of syncService.ts:

```typescript
import {
  getAppConfig,
  bulkUpsertSyncStates,
  getRules,
  getFilters,
  getCachedProductsByIds,
  upsertSyncProgress,
  getBatchProductPlatforms,
} from './dataService';
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260402_platform_targeting.sql src/types/wix.types.ts src/backend/dataService.ts src/backend/syncService.ts
git commit -m "feat: per-product platform targeting with schema migration"
```

---

## Task 5: Platform targeting API endpoint

**Files:**
- Create: `src/pages/api/product-platforms.ts`

- [ ] **Step 1: Create the endpoint**

Create `src/pages/api/product-platforms.ts`:

```typescript
import { getProductPlatforms, setProductPlatforms } from '../../backend/dataService';

/** GET: query platforms for a product. POST: set platforms for one or more products. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  if (!productId) {
    return new Response(JSON.stringify({ error: 'productId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const platforms = await getProductPlatforms(productId);
  return new Response(JSON.stringify({ productId, platforms }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const productIds: string[] = body.productIds;
    const platforms: ('gmc' | 'meta')[] | null = body.platforms;

    if (!productIds || productIds.length === 0) {
      return new Response(JSON.stringify({ error: 'productIds required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate platform values
    if (platforms !== null) {
      const valid = ['gmc', 'meta'];
      if (!platforms.every((p) => valid.includes(p))) {
        return new Response(JSON.stringify({ error: 'Invalid platform. Use "gmc", "meta", or null for all.' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    await setProductPlatforms(productIds, platforms);

    return new Response(JSON.stringify({
      success: true,
      updated: productIds.length,
      platforms,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update platforms';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/api/product-platforms.ts
git commit -m "feat: product-platforms API endpoint for per-product targeting"
```

---

## Task 6: Dashboard UI — compliance health score

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

This task adds a "Check Now" button and health score card to the Products tab (workbench).

- [ ] **Step 1: Add compliance state and fetch function**

In `sync-stream.tsx`, add state variables near the other workbench state (around line 700):

```typescript
const [complianceLoading, setComplianceLoading] = useState(false);
const [compliance, setCompliance] = useState<{
  healthScore: number;
  totalProducts: number;
  compliantCount: number;
  warningCount: number;
  errorCount: number;
} | null>(null);

const handleComplianceCheck = useCallback(async () => {
  setComplianceLoading(true); setError(null);
  try {
    const ids = selected.size > 0
      ? Array.from(selected)
      : filteredProducts.map((p) => p.productId);
    const response = await appFetch('/api/compliance-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'default', productIds: ids, platform: 'gmc' }),
    });
    const data = await response.json();
    if (data.error) { setError(data.error); return; }
    setCompliance(data);
    setSuccess(`Compliance check complete: ${data.healthScore}% healthy`);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Compliance check failed');
  } finally { setComplianceLoading(false); }
}, [selected, filteredProducts]);
```

- [ ] **Step 2: Add compliance summary card in the workbench UI**

Add the card above the product table (before the `<Table>` component, around line 1130). Place it after the AI preview section and before the table:

```tsx
{compliance && (
  <Card>
    <Card.Header title="Feed Health" suffix={
      <Badge skin={compliance.healthScore >= 90 ? 'success' : compliance.healthScore >= 70 ? 'warning' : 'danger'}>
        {compliance.healthScore}%
      </Badge>
    } />
    <Card.Content>
      <Box direction="horizontal" gap="24px">
        <Text size="small">{compliance.compliantCount} compliant</Text>
        <Text size="small" skin="standard">{compliance.warningCount} warnings</Text>
        <Text size="small" skin="destructive">{compliance.errorCount} errors</Text>
        <Text size="small" secondary>of {compliance.totalProducts} products</Text>
      </Box>
    </Card.Content>
  </Card>
)}
```

- [ ] **Step 3: Add "Check Now" button to the TableToolbar**

In the `<TableToolbar>` section (around line 1219), add the button:

```tsx
<TableToolbar>
  <TableToolbar.Title>
    Products ({filteredProducts.length})
  </TableToolbar.Title>
  <TableToolbar.Item>
    <Button size="small" skin="light" onClick={handleComplianceCheck} disabled={complianceLoading}>
      {complianceLoading ? 'Checking...' : 'Check Now'}
    </Button>
  </TableToolbar.Item>
</TableToolbar>
```

- [ ] **Step 4: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: compliance health score card with Check Now button"
```

---

## Task 7: Dashboard UI — per-product platform toggles

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

- [ ] **Step 1: Add platform state tracking**

Add state near the workbench state block:

```typescript
const [productPlatforms, setProductPlatforms] = useState<Map<string, ('gmc' | 'meta')[] | null>>(new Map());
```

- [ ] **Step 2: Add platform toggle handler**

```typescript
const handlePlatformToggle = useCallback(async (productIds: string[], platform: 'gmc' | 'meta', enabled: boolean) => {
  // Compute new platforms for each product
  for (const id of productIds) {
    const current = productPlatforms.get(id) ?? ['gmc', 'meta'];
    const updated = enabled
      ? [...new Set([...current, platform])]
      : current.filter((p) => p !== platform);
    const finalPlatforms = updated.length === 2 ? null : updated as ('gmc' | 'meta')[];

    try {
      await appFetch('/api/product-platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: [id], platforms: finalPlatforms }),
      });
      setProductPlatforms((prev) => {
        const next = new Map(prev);
        next.set(id, finalPlatforms);
        return next;
      });
    } catch {
      setError('Failed to update platform targeting');
    }
  }
}, [productPlatforms]);
```

- [ ] **Step 3: Add platform column to the product table**

In the `columns` array of the product `<Table>` (around line 1132), add a column after the existing columns:

```tsx
{
  title: 'Platforms',
  render: (row: WorkbenchProduct) => {
    const platforms = productPlatforms.get(row.productId) ?? ['gmc', 'meta'];
    return (
      <Box direction="horizontal" gap="4px">
        <Badge
          size="small"
          skin={platforms.includes('gmc') ? 'success' : 'neutral'}
          onClick={() => handlePlatformToggle([row.productId], 'gmc', !platforms.includes('gmc'))}
        >
          GMC
        </Badge>
        <Badge
          size="small"
          skin={platforms.includes('meta') ? 'success' : 'neutral'}
          onClick={() => handlePlatformToggle([row.productId], 'meta', !platforms.includes('meta'))}
        >
          Meta
        </Badge>
      </Box>
    );
  },
  width: '120px',
},
```

- [ ] **Step 4: Add bulk platform targeting to toolbar**

In the `<TableToolbar>`, add a bulk action dropdown when products are selected:

```tsx
{selected.size > 0 && (
  <TableToolbar.Item>
    <Dropdown
      size="small"
      placeholder="Set platforms..."
      options={[
        { id: 'all', value: 'All platforms' },
        { id: 'gmc', value: 'GMC only' },
        { id: 'meta', value: 'Meta only' },
      ]}
      onSelect={(option) => {
        const ids = Array.from(selected);
        const platforms = option.id === 'all' ? null
          : option.id === 'gmc' ? ['gmc'] as ('gmc' | 'meta')[]
          : ['meta'] as ('gmc' | 'meta')[];
        handlePlatformToggle(ids, 'gmc', platforms === null || platforms.includes('gmc'));
      }}
    />
  </TableToolbar.Item>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: per-product platform targeting toggles in workbench"
```

---

## Task 8: Product images — verify image column exists and enhance

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

The workbench already displays product images (line 1143: `row.imageUrl` rendered as 40x40 thumbnail). This task enhances it with a larger preview on hover and labels the column.

- [ ] **Step 1: Update the image column title and add hover preview**

Find the image column in the table (around line 1140) and update:

```tsx
{
  title: 'Image',
  render: (row: WorkbenchProduct) => (
    row.imageUrl
      ? <Box style={{ position: 'relative' }}>
          <img
            src={row.imageUrl}
            alt={row.name ?? ''}
            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
            title="Image being synced to GMC/Meta"
          />
        </Box>
      : <Box width="40px" height="40px" />
  ),
  width: '60px',
},
```

- [ ] **Step 2: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: label product image column in workbench"
```

---

## Verification

After all tasks are complete:

1. **SKU handling:** Pull products, check that products with SKUs use the SKU as `offerId` in the GMC preview. Products without SKUs should show a warning (yellow) in compliance check.

2. **Compliance check:** Click "Check Now" in the workbench. Verify health score card appears with correct counts. Verify it works without triggering a sync.

3. **Platform targeting:** Toggle a product to "GMC only". Run a sync. Verify only GMC-targeted products are pushed. Toggle back to "All" and verify it syncs again.

4. **Product images:** Verify thumbnails display in the workbench table with the "Image" column header.
