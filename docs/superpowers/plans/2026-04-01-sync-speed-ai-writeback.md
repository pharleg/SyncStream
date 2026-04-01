# Sync Speed + AI Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product sync 3-5x faster via parallelization and auto-pagination, and add AI description writeback to Wix for SEO consistency across all platforms.

**Architecture:** Two independent workstreams. Part 1 modifies the sync pipeline (gmcClient, syncService) with a concurrency utility and progress tracking. Part 2 adds a Wix writeback function in aiEnhancer.ts, a new API endpoint, and a preview modal in the Products workbench UI.

**Tech Stack:** TypeScript, Supabase (Postgres), Wix SDK (`@wix/stores` productsV3), Wix Design System, Anthropic SDK, Astro API routes.

---

## File Map

### Part 1: Sync Speed

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/backend/gmcClient.ts` | Add `withConcurrency()` helper, parallelize `batchInsertProducts()` |
| Modify | `src/backend/syncService.ts` | Raise limit to 15, parallelize Wix fetches, add `runPaginatedSync()`, progress tracking |
| Modify | `src/types/sync.types.ts` | Add `offset` to `SyncOptions`, add `PaginatedSyncResult` and `SyncProgress` types |
| Modify | `src/backend/dataService.ts` | Add `upsertSyncProgress()` and `getSyncProgress()` CRUD |
| Create | `supabase/migrations/20260401_sync_progress.sql` | Create `sync_progress` table |
| Modify | `src/pages/api/sync-trigger.ts` | Call `runPaginatedSync()` instead of `runFullSync()` |
| Create | `src/pages/api/sync-progress.ts` | GET endpoint for progress polling |
| Modify | `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | Add progress bar to DashboardTab sync trigger |

### Part 2: AI Writeback

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/backend/aiEnhancer.ts` | Add `applyEnhancementsToWix()` function |
| Create | `src/pages/api/products-apply-ai.ts` | POST endpoint to write AI descriptions back to Wix |
| Modify | `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | Add enhancement preview modal and "Apply to Store" flow |

---

## Task 1: Concurrency Utility + Parallel GMC Inserts

**Files:**
- Modify: `src/backend/gmcClient.ts:98-133`

- [ ] **Step 1: Add `withConcurrency()` helper to gmcClient.ts**

Add this above the `batchInsertProducts` function:

```typescript
/**
 * Run async tasks with a concurrency limit.
 * Returns results in the same order as the input tasks.
 */
async function withConcurrency<T>(
  limit: number,
  tasks: (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 2: Rewrite `batchInsertProducts()` to use parallel concurrency**

Replace the existing `batchInsertProducts` function body (lines 98-133) with:

```typescript
export async function batchInsertProducts(
  merchantId: string,
  dataSourceId: string,
  products: GmcProductInput[],
  accessToken: string,
): Promise<GmcInsertResult[]> {
  const tasks = products.map((product) => () =>
    insertProduct(merchantId, dataSourceId, product, accessToken)
      .then((response): GmcInsertResult => ({
        offerId: product.offerId,
        success: true,
        name: response.name,
      }))
      .catch((error): GmcInsertResult => ({
        offerId: product.offerId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })),
  );

  const settled = await withConcurrency(5, tasks);
  return settled.map((r) =>
    r.status === 'fulfilled' ? r.value : { offerId: '', success: false, error: 'Worker failed' },
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/backend/gmcClient.ts
git commit -m "feat: parallelize GMC inserts with concurrency(5)"
```

---

## Task 2: Types for Paginated Sync and Progress

**Files:**
- Modify: `src/types/sync.types.ts`

- [ ] **Step 1: Add offset, progress, and paginated result types**

Append to the end of `src/types/sync.types.ts`:

```typescript
export interface SyncProgress {
  instanceId: string;
  totalProducts: number;
  processed: number;
  currentStatus: 'running' | 'completed' | 'error';
  syncedCount: number;
  failedCount: number;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

export interface PaginatedSyncResult extends BatchSyncResult {
  progress: SyncProgress;
}
```

Also update the existing `SyncOptions` interface to add `offset`:

```typescript
export interface SyncOptions {
  platforms: Platform[];
  productIds?: string[];
  fullSync?: boolean;
  offset?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/sync.types.ts
git commit -m "feat: add SyncProgress and PaginatedSyncResult types"
```

---

## Task 3: Sync Progress Supabase Migration + CRUD

**Files:**
- Create: `supabase/migrations/20260401_sync_progress.sql`
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260401_sync_progress.sql`:

```sql
-- Sync progress tracking for paginated sync operations
CREATE TABLE IF NOT EXISTS sync_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL UNIQUE,
  total_products INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  current_status TEXT NOT NULL DEFAULT 'running' CHECK (current_status IN ('running', 'completed', 'error')),
  synced_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_progress_instance ON sync_progress(instance_id);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the Supabase MCP `apply_migration` tool to run this migration.

- [ ] **Step 3: Add CRUD functions to dataService.ts**

Add at the end of `src/backend/dataService.ts`, before the closing of the file:

```typescript
// ── Sync Progress CRUD ──

import type { SyncProgress } from '../types/sync.types';

export async function upsertSyncProgress(progress: SyncProgress): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('sync_progress')
    .upsert({
      instance_id: progress.instanceId,
      total_products: progress.totalProducts,
      processed: progress.processed,
      current_status: progress.currentStatus,
      synced_count: progress.syncedCount,
      failed_count: progress.failedCount,
      started_at: progress.startedAt,
      updated_at: new Date().toISOString(),
      error: progress.error ?? null,
    }, { onConflict: 'instance_id' });
  if (error) throw new Error(`Failed to upsert sync progress: ${error.message}`);
}

export async function getSyncProgress(instanceId: string): Promise<SyncProgress | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_progress')
    .select('*')
    .eq('instance_id', instanceId)
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    instanceId: data.instance_id,
    totalProducts: data.total_products,
    processed: data.processed,
    currentStatus: data.current_status,
    syncedCount: data.synced_count,
    failedCount: data.failed_count,
    startedAt: data.started_at,
    updatedAt: data.updated_at,
    error: data.error ?? undefined,
  };
}
```

Note: The `SyncProgress` import should be added alongside the existing type imports at the top of the file. Add it to the existing import from `'../types/sync.types'`:

```typescript
import type { Platform, SyncProgress } from '../types/sync.types';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260401_sync_progress.sql src/backend/dataService.ts
git commit -m "feat: add sync_progress table and CRUD operations"
```

---

## Task 4: Parallelize Wix Multi-Variant Fetches + Raise Limit

**Files:**
- Modify: `src/backend/syncService.ts:38-98` (fetchAllProducts)
- Modify: `src/backend/syncService.ts:140` (MAX_PRODUCTS_PER_SYNC)

- [ ] **Step 1: Import withConcurrency from gmcClient or extract to shared util**

Since `withConcurrency` is a general utility, copy it into syncService.ts as a private function (same implementation as in gmcClient.ts). Add it near the top of the file, after imports:

```typescript
/** Run async tasks with a concurrency limit. */
async function withConcurrency<T>(
  limit: number,
  tasks: (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 2: Rewrite `fetchAllProducts()` to batch multi-variant fetches**

Replace the `fetchAllProducts` function (lines 38-98) with:

```typescript
async function fetchAllProducts(): Promise<WixProduct[]> {
  const { productsV3 } = await import('@wix/stores');
  const singleVariantProducts: WixProduct[] = [];
  const multiVariantIds: string[] = [];
  let cursor: string | undefined;

  // Phase 1: Query all products, collect multi-variant IDs
  do {
    const response = await productsV3.queryProducts(
      { cursorPaging: { limit: 100, cursor } },
      {
        fields: [
          'URL', 'CURRENCY', 'PLAIN_DESCRIPTION',
          'MEDIA_ITEMS_INFO', 'VARIANT_OPTION_CHOICE_NAMES',
        ],
      },
    );

    for (const p of response.products ?? []) {
      const product = p as any;
      const variantCount = product.variantSummary?.variantCount ?? 1;
      if (variantCount > 1) {
        multiVariantIds.push(product._id ?? product.id);
      } else {
        singleVariantProducts.push(product as unknown as WixProduct);
      }
    }

    cursor = (response.pagingMetadata as any)?.cursors?.next ?? undefined;
  } while (cursor);

  // Phase 2: Batch-fetch multi-variant products with concurrency(5)
  const fetchTasks = multiVariantIds.map((id) => async () => {
    const fullProduct = await productsV3.getProduct(id, {
      fields: [
        'URL', 'CURRENCY', 'PLAIN_DESCRIPTION',
        'MEDIA_ITEMS_INFO', 'VARIANT_OPTION_CHOICE_NAMES',
      ],
    });
    return fullProduct as unknown as WixProduct;
  });

  const settled = await withConcurrency(5, fetchTasks);
  const multiVariantProducts = settled
    .filter((r): r is PromiseFulfilledResult<WixProduct> => r.status === 'fulfilled')
    .map((r) => r.value);

  return [...singleVariantProducts, ...multiVariantProducts];
}
```

- [ ] **Step 3: Raise MAX_PRODUCTS_PER_SYNC from 5 to 15**

Change line 140 in syncService.ts:

```typescript
const MAX_PRODUCTS_PER_SYNC = 15;
```

- [ ] **Step 4: Commit**

```bash
git add src/backend/syncService.ts
git commit -m "feat: parallelize Wix fetches and raise sync limit to 15"
```

---

## Task 5: Add `runPaginatedSync()` with Progress Tracking

**Files:**
- Modify: `src/backend/syncService.ts`

- [ ] **Step 1: Add imports for progress tracking**

Add to the existing imports from `./dataService`:

```typescript
import {
  getAppConfig,
  bulkUpsertSyncStates,
  getRules,
  getFilters,
  getCachedProductsByIds,
  upsertSyncProgress,
} from './dataService';
```

Add to the existing imports from types:

```typescript
import type {
  BatchSyncResult,
  SyncOptions,
  SyncResult,
  PaginatedSyncResult,
  SyncProgress,
} from '../types/sync.types';
```

- [ ] **Step 2: Modify `runFullSync` to accept and use offset**

In `runFullSync`, after the `allProducts` fetch block (around line 137), replace the slicing logic:

```typescript
  // Apply offset for paginated sync
  const offset = options.offset ?? 0;
  const MAX_PRODUCTS_PER_SYNC = 15;
  const products = allProducts.slice(offset, offset + MAX_PRODUCTS_PER_SYNC);
  const hasMore = offset + MAX_PRODUCTS_PER_SYNC < allProducts.length;
```

At the end of `runFullSync`, before the return statement, change the return to include pagination info. Replace the final return block:

```typescript
  const synced = results.filter((r) => r.success).length;
  return {
    total: results.length,
    synced,
    failed: results.length - synced,
    results,
    _totalProducts: allProducts.length,
    _hasMore: hasMore,
    _nextOffset: hasMore ? offset + MAX_PRODUCTS_PER_SYNC : undefined,
  } as BatchSyncResult & { _totalProducts: number; _hasMore: boolean; _nextOffset?: number };
```

- [ ] **Step 3: Add `runPaginatedSync()` function**

Add at the end of `syncService.ts`:

```typescript
/**
 * Run a full catalog sync with automatic pagination and progress tracking.
 * Processes all products in chunks of MAX_PRODUCTS_PER_SYNC.
 */
export async function runPaginatedSync(
  instanceId: string,
  platforms: SyncOptions['platforms'],
): Promise<PaginatedSyncResult> {
  const allResults: SyncResult[] = [];
  let offset = 0;
  let totalProducts = 0;

  const progress: SyncProgress = {
    instanceId,
    totalProducts: 0,
    processed: 0,
    currentStatus: 'running',
    syncedCount: 0,
    failedCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await upsertSyncProgress(progress);

  try {
    let hasMore = true;

    while (hasMore) {
      const result = await runFullSync(instanceId, { platforms, offset }) as BatchSyncResult & {
        _totalProducts: number;
        _hasMore: boolean;
        _nextOffset?: number;
      };

      allResults.push(...result.results);
      totalProducts = result._totalProducts;
      hasMore = result._hasMore;
      offset = result._nextOffset ?? offset;

      // Update progress after each chunk
      progress.totalProducts = totalProducts;
      progress.processed = Math.min(offset, totalProducts);
      progress.syncedCount = allResults.filter((r) => r.success).length;
      progress.failedCount = allResults.filter((r) => !r.success).length;
      progress.updatedAt = new Date().toISOString();

      await upsertSyncProgress(progress);
    }

    progress.currentStatus = 'completed';
    progress.processed = totalProducts;
    await upsertSyncProgress(progress);
  } catch (error) {
    progress.currentStatus = 'error';
    progress.error = error instanceof Error ? error.message : 'Unknown error';
    await upsertSyncProgress(progress);
    throw error;
  }

  const synced = allResults.filter((r) => r.success).length;
  return {
    total: allResults.length,
    synced,
    failed: allResults.length - synced,
    results: allResults,
    progress,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/backend/syncService.ts
git commit -m "feat: add runPaginatedSync with progress tracking"
```

---

## Task 6: Sync Progress API Endpoint + Update Sync Trigger

**Files:**
- Create: `src/pages/api/sync-progress.ts`
- Modify: `src/pages/api/sync-trigger.ts`

- [ ] **Step 1: Create sync-progress GET endpoint**

Create `src/pages/api/sync-progress.ts`:

```typescript
import type { APIRoute } from 'astro';
import { getSyncProgress } from '../../backend/dataService';

export const GET: APIRoute = async ({ url }) => {
  try {
    const instanceId = url.searchParams.get('instanceId') ?? 'default';
    const progress = await getSyncProgress(instanceId);

    if (!progress) {
      return new Response(JSON.stringify({ progress: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ progress }), {
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

- [ ] **Step 2: Update sync-trigger to use runPaginatedSync**

Replace the contents of `src/pages/api/sync-trigger.ts`:

```typescript
/**
 * POST /api/sync-trigger
 * Triggers a paginated full sync for the given instance.
 * Returns final results after all chunks are processed.
 */
import type { APIRoute } from 'astro';
import { runPaginatedSync } from '../../backend/syncService';
import type { Platform } from '../../types/sync.types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      instanceId: string;
      platforms?: Platform[];
    };

    const result = await runPaginatedSync(
      body.instanceId,
      body.platforms ?? ['gmc'],
    );

    return new Response(JSON.stringify(result), {
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
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/sync-progress.ts src/pages/api/sync-trigger.ts
git commit -m "feat: add sync-progress endpoint and wire sync-trigger to paginated sync"
```

---

## Task 7: Dashboard Progress Bar for Sync

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

- [ ] **Step 1: Find the DashboardTab component's sync trigger section**

The DashboardTab (formerly StatusTab) has a "Trigger Full Sync" button. Locate it (search for `sync-trigger` or `Trigger Full Sync` in the file).

- [ ] **Step 2: Add progress polling state and handler**

In the DashboardTab component, add state variables for progress tracking. Add these alongside existing state:

```typescript
const [syncProgress, setSyncProgress] = useState<{
  totalProducts: number;
  processed: number;
  currentStatus: string;
  syncedCount: number;
  failedCount: number;
} | null>(null);
```

Add a polling function:

```typescript
const pollProgress = useCallback(async () => {
  try {
    const response = await appFetch('/api/sync-progress?instanceId=default');
    const data = await response.json();
    if (data.progress) {
      setSyncProgress(data.progress);
      if (data.progress.currentStatus === 'running') {
        setTimeout(pollProgress, 2000);
      }
    }
  } catch { /* ignore polling errors */ }
}, []);
```

- [ ] **Step 3: Wire the sync trigger to start polling**

In the existing sync trigger handler, after the fetch call to `/api/sync-trigger`, start polling:

```typescript
// Start polling for progress immediately
pollProgress();
```

And after the sync completes (in the `.then` or after `await`), clear the progress:

```typescript
setSyncProgress(null);
```

- [ ] **Step 4: Add progress bar UI**

Below the sync trigger button, add a progress display:

```typescript
{syncProgress && syncProgress.currentStatus === 'running' && (
  <Box direction="vertical" gap="6px" marginTop="12px">
    <Box gap="6px" verticalAlign="middle">
      <Loader size="tiny" />
      <Text size="small">
        Syncing: {syncProgress.processed} / {syncProgress.totalProducts} products
      </Text>
    </Box>
    <Box
      height="8px"
      backgroundColor="#E8E8E8"
      borderRadius="4px"
      overflow="hidden"
    >
      <Box
        height="100%"
        width={`${syncProgress.totalProducts > 0
          ? Math.round((syncProgress.processed / syncProgress.totalProducts) * 100)
          : 0}%`}
        backgroundColor="#3B82F6"
        borderRadius="4px"
      />
    </Box>
    <Text size="tiny" secondary>
      {syncProgress.syncedCount} synced, {syncProgress.failedCount} failed
    </Text>
  </Box>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: add sync progress bar to dashboard"
```

---

## Task 8: AI Writeback Function in aiEnhancer.ts

**Files:**
- Modify: `src/backend/aiEnhancer.ts`
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Add `applyEnhancementsToWix()` to aiEnhancer.ts**

Add at the end of `src/backend/aiEnhancer.ts`:

```typescript
/**
 * Write AI-enhanced titles and descriptions back to Wix products.
 * This is the ONLY place Wix product writes happen for AI content.
 */
export async function applyEnhancementsToWix(
  instanceId: string,
  productUpdates: Array<{ productId: string; title: string; description: string }>,
): Promise<Array<{ productId: string; success: boolean; error?: string }>> {
  const { productsV3 } = await import('@wix/stores');
  const results: Array<{ productId: string; success: boolean; error?: string }> = [];

  for (const update of productUpdates) {
    try {
      await productsV3.updateProduct(update.productId, {
        product: {
          name: update.title,
          description: update.description,
        },
      });
      results.push({ productId: update.productId, success: true });
    } catch (error) {
      results.push({
        productId: update.productId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
```

- [ ] **Step 2: Add `updateCachedProductFields()` to dataService.ts**

Add to `src/backend/dataService.ts` near the products cache section:

```typescript
export async function updateCachedProductFields(
  instanceId: string,
  productId: string,
  fields: { name?: string; description?: string; plainDescription?: string },
): Promise<void> {
  const db = await getClient();

  const updateData: Record<string, unknown> = { cached_at: new Date().toISOString() };
  if (fields.name !== undefined) updateData.name = fields.name;
  if (fields.description !== undefined) updateData.description = fields.description;
  if (fields.plainDescription !== undefined) updateData.plain_description = fields.plainDescription;

  const { error } = await db
    .from('products_cache')
    .update(updateData)
    .eq('instance_id', instanceId)
    .eq('product_id', productId);

  if (error) throw new Error(`Failed to update cached product: ${error.message}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/backend/aiEnhancer.ts src/backend/dataService.ts
git commit -m "feat: add applyEnhancementsToWix and cache update functions"
```

---

## Task 9: AI Writeback API Endpoint

**Files:**
- Create: `src/pages/api/products-apply-ai.ts`

- [ ] **Step 1: Create the endpoint**

Create `src/pages/api/products-apply-ai.ts`:

```typescript
/**
 * POST /api/products-apply-ai
 * Two modes:
 *   - preview: { instanceId, productIds } → returns before/after for each product
 *   - apply:   { instanceId, updates: [{ productId, title, description }] } → writes to Wix
 */
import type { APIRoute } from 'astro';
import {
  getCachedProductsByIds,
  getAppConfig,
  updateCachedProductFields,
} from '../../backend/dataService';
import { enhanceProducts, applyEnhancementsToWix } from '../../backend/aiEnhancer';
import type { WixProduct } from '../../types/wix.types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId = body.instanceId ?? 'default';

    // Mode 1: Preview — generate enhancements and return before/after
    if (body.productIds && !body.updates) {
      const productIds: string[] = body.productIds;
      const config = await getAppConfig(instanceId);
      const cached = await getCachedProductsByIds(instanceId, productIds);
      const products = cached.map((cp) => cp.productData as WixProduct);

      const enhancedMap = await enhanceProducts(products, instanceId, config?.aiEnhancementStyle);

      const previews = cached.map((cp) => {
        const enhanced = enhancedMap.get(cp.productId);
        return {
          productId: cp.productId,
          original: {
            title: cp.name,
            description: cp.plainDescription ?? cp.description ?? '',
          },
          enhanced: enhanced
            ? { title: enhanced.title, description: enhanced.description }
            : null,
        };
      });

      return new Response(JSON.stringify({ success: true, previews }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mode 2: Apply — write accepted enhancements to Wix and update cache
    if (body.updates) {
      const updates: Array<{ productId: string; title: string; description: string }> = body.updates;

      const wixResults = await applyEnhancementsToWix(instanceId, updates);

      // Update products_cache for successful writes
      for (const result of wixResults) {
        if (result.success) {
          const update = updates.find((u) => u.productId === result.productId);
          if (update) {
            await updateCachedProductFields(instanceId, result.productId, {
              name: update.title,
              description: update.description,
              plainDescription: update.description,
            });
          }
        }
      }

      const applied = wixResults.filter((r) => r.success).length;
      const failed = wixResults.filter((r) => !r.success).length;

      return new Response(JSON.stringify({
        success: true,
        applied,
        failed,
        results: wixResults,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Provide productIds (preview) or updates (apply)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/api/products-apply-ai.ts
git commit -m "feat: add products-apply-ai endpoint with preview and apply modes"
```

---

## Task 10: Enhancement Preview Modal in Products Workbench

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

- [ ] **Step 1: Add state for the AI apply flow**

In the `ProductsTab` component, add these state variables alongside the existing ones (near line 766):

```typescript
const [aiPreviews, setAiPreviews] = useState<Array<{
  productId: string;
  original: { title: string; description: string };
  enhanced: { title: string; description: string } | null;
  accepted: boolean;
}> | null>(null);
const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
const [aiApplying, setAiApplying] = useState(false);
```

- [ ] **Step 2: Add preview handler**

Add this handler alongside the existing `handleEnhanceBulk`:

```typescript
const handleEnhanceAndPreview = useCallback(async () => {
  if (selected.size === 0) return;
  setAiPreviewLoading(true); setError(null);
  try {
    const response = await appFetch('/api/products-apply-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'default', productIds: Array.from(selected) }),
    });
    const data = await response.json();
    setAiPreviews(
      (data.previews ?? []).map((p: any) => ({ ...p, accepted: true })),
    );
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to generate previews');
  } finally { setAiPreviewLoading(false); }
}, [selected]);
```

- [ ] **Step 3: Add apply handler**

```typescript
const handleApplyToStore = useCallback(async () => {
  if (!aiPreviews) return;
  const accepted = aiPreviews.filter((p) => p.accepted && p.enhanced);
  if (accepted.length === 0) { setAiPreviews(null); return; }

  setAiApplying(true); setError(null);
  try {
    const response = await appFetch('/api/products-apply-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: 'default',
        updates: accepted.map((p) => ({
          productId: p.productId,
          title: p.enhanced!.title,
          description: p.enhanced!.description,
        })),
      }),
    });
    const data = await response.json();
    setSuccess(`Applied AI descriptions to ${data.applied} products.${data.failed > 0 ? ` ${data.failed} failed.` : ''}`);
    setAiPreviews(null);
    await loadProducts();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to apply enhancements');
  } finally { setAiApplying(false); }
}, [aiPreviews, loadProducts]);
```

- [ ] **Step 4: Replace the "Generate AI" toolbar button**

In the toolbar section (around line 934), replace the existing "Generate AI" button with:

```typescript
{selected.size > 0 && (
  <Button size="small" onClick={handleEnhanceAndPreview} disabled={aiPreviewLoading}>
    {aiPreviewLoading ? 'Generating...' : `Enhance with AI (${selected.size})`}
  </Button>
)}
```

- [ ] **Step 5: Add the preview modal UI**

Add this block right after the toolbar `<Box>` (after line 946), before the filter bar:

```typescript
{/* AI Enhancement Preview */}
{aiPreviews && (
  <Card>
    <Card.Header
      title="AI Enhancement Preview"
      subtitle={`${aiPreviews.filter((p) => p.accepted).length} of ${aiPreviews.length} selected for update`}
      suffix={
        <Box gap="12px">
          <Button size="small" priority="secondary" onClick={() => setAiPreviews(null)}>
            Cancel
          </Button>
          <Button size="small" skin="dark" onClick={handleApplyToStore} disabled={aiApplying}>
            {aiApplying ? 'Applying...' : 'Apply to Store'}
          </Button>
        </Box>
      }
    />
    <Card.Divider />
    <Card.Content>
      <Box direction="vertical" gap="12px" maxHeight="400px" overflowY="auto">
        {aiPreviews.map((preview) => (
          <Card key={preview.productId}>
            <Card.Content>
              <Box gap="12px" verticalAlign="top">
                <Box width="30px">
                  <ToggleSwitch
                    size="small"
                    checked={preview.accepted}
                    onChange={() => {
                      setAiPreviews((prev) =>
                        prev?.map((p) =>
                          p.productId === preview.productId
                            ? { ...p, accepted: !p.accepted }
                            : p,
                        ) ?? null,
                      );
                    }}
                  />
                </Box>
                <Box direction="vertical" gap="6px" width="100%">
                  <Box gap="12px">
                    <Box direction="vertical" width="50%">
                      <Text size="tiny" weight="bold" secondary>Original Title</Text>
                      <Text size="small">{preview.original.title}</Text>
                    </Box>
                    <Box direction="vertical" width="50%">
                      <Text size="tiny" weight="bold" skin="success">Enhanced Title</Text>
                      <Text size="small">{preview.enhanced?.title ?? '—'}</Text>
                    </Box>
                  </Box>
                  <Box gap="12px">
                    <Box direction="vertical" width="50%">
                      <Text size="tiny" weight="bold" secondary>Original Description</Text>
                      <Text size="tiny">{(preview.original.description ?? '').slice(0, 200)}{(preview.original.description ?? '').length > 200 ? '...' : ''}</Text>
                    </Box>
                    <Box direction="vertical" width="50%">
                      <Text size="tiny" weight="bold" skin="success">Enhanced Description</Text>
                      <Text size="tiny">{(preview.enhanced?.description ?? '').slice(0, 200)}{(preview.enhanced?.description ?? '').length > 200 ? '...' : ''}</Text>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Card.Content>
          </Card>
        ))}
      </Box>
    </Card.Content>
  </Card>
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: add AI enhancement preview modal with writeback to Wix"
```

---

## Task 11: Update products-sync to use Higher Limit

**Files:**
- Modify: `src/backend/syncService.ts` (syncFromCache function)

- [ ] **Step 1: Apply the same MAX_PRODUCTS_PER_SYNC increase to syncFromCache**

In `syncFromCache()` (around line 270), the function currently has no product limit since it works from explicit product IDs. Verify no limit is needed — the workbench sync already sends specific IDs. No change needed if it processes all passed IDs.

However, check that `syncFromCache` also benefits from parallel GMC inserts — it already calls `batchInsertProducts()` which was parallelized in Task 1. Verify this is the case.

- [ ] **Step 2: Commit (only if changes were made)**

```bash
git add src/backend/syncService.ts
git commit -m "chore: verify syncFromCache uses parallelized GMC inserts"
```

