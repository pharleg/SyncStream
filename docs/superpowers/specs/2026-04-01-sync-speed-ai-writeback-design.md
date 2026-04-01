# Sync Speed + AI Writeback Design

**Date:** 2026-04-01
**Status:** Approved

## Problem

1. Product sync is painfully slow — limited to 5 products per invocation with sequential GMC API calls
2. AI-enhanced descriptions only appear in GMC/Meta feeds, not on the Wix site — creating SEO inconsistency

## Part 1: Faster Sync Pipeline

### Per-Invocation Improvements

**Raise product limit from 5 to 15:**
- Secret caching (implemented Mar 30) freed ~10 subrequests from the Cloudflare Workers 50-subrequest budget
- New budget per invocation:
  - 3 config/auth calls (getAppConfig, getGmcTokens, getAccessToken)
  - 15 product fetches (worst case multi-variant getProduct calls)
  - 3 pipeline calls (getFilters, getRules, getBulkEnhancedContent)
  - 15 GMC inserts
  - 1 bulkUpsertSyncStates
  - Total: ~38 subrequests (under 50 limit)

**Parallelize GMC inserts:**
- Replace sequential for-loop in `batchInsertProducts()` with `Promise.allSettled`
- Concurrency limiter: max 5 concurrent GMC API calls
- Implements a simple semaphore pattern (no external dependencies)

**Parallelize multi-variant Wix fetches:**
- `fetchAllProducts()` currently awaits each multi-variant `getProduct()` serially
- Batch multi-variant product IDs, fetch with `Promise.allSettled` (5 concurrent)

### Auto-Pagination for Full Catalog

**Self-continuing sync:**
- `runFullSync()` gains an `offset` parameter for cursor-based chunking
- After processing a chunk, if more products remain, continues to next chunk
- Single dashboard trigger processes the entire catalog across multiple chunks

**Progress tracking:**
- New Supabase table or record: `sync_progress`
  - Fields: `instance_id`, `total_products`, `processed`, `current_status`, `started_at`, `updated_at`
- Each chunk updates the progress record
- Dashboard polls `sync_progress` to display a progress bar instead of a spinner

**Changes to `syncService.ts`:**
- `MAX_PRODUCTS_PER_SYNC` = 15
- New `offset` parameter on `runFullSync()` / `SyncOptions`
- New `runPaginatedSync()` that loops `runFullSync` with incrementing offset
- Progress writes after each chunk

**Changes to `gmcClient.ts`:**
- `batchInsertProducts()` uses parallel `Promise.allSettled` with concurrency(5)
- Add `withConcurrency(limit, tasks)` utility function in the same file

**Changes to `syncService.ts` `fetchAllProducts()`:**
- Collect multi-variant product IDs during pagination
- Batch-fetch with concurrency(5) after the query loop

## Part 2: AI Description Writeback to Wix

### User Flow

1. Merchant opens Products workbench, selects products
2. Clicks "Enhance with AI" button in workbench toolbar
3. Backend generates enhancements (or returns cached if source hash matches)
4. Dashboard shows before/after preview: original title/description vs AI-enhanced version
5. Merchant toggles per-product accept/reject
6. Clicks "Apply to Store"
7. Backend writes accepted enhancements to Wix via `productsV3.updateProduct()`
8. Products cache updated to reflect new content
9. Future syncs to GMC/Meta use the same content — SEO consistent across all platforms

### What It Does NOT Do

- Does not run during sync — sync uses cached AI content only
- Does not overwrite without preview — merchant always sees the diff
- Does not touch other product fields (price, images, inventory, etc.)

### Backend Changes

**New function in `aiEnhancer.ts`:**
```typescript
export async function applyEnhancementsToWix(
  instanceId: string,
  productUpdates: Array<{ productId: string; title: string; description: string }>
): Promise<Array<{ productId: string; success: boolean; error?: string }>>
```
- Calls `productsV3.updateProduct()` for each accepted product
- Updates only `name` and `description` fields
- Returns success/failure per product
- This is the ONLY place Wix product writes happen for AI content

**New API endpoint:**
- `applyAiEnhancements(instanceId, productIds)` — generates/returns previews
- `confirmAiEnhancements(instanceId, updates)` — writes to Wix + updates cache

### Dashboard Changes

**Products workbench additions:**
- "Enhance with AI" button in toolbar (enabled when products selected)
- Enhancement preview modal:
  - Side-by-side diff view per product (original left, enhanced right)
  - Per-product toggle to accept/reject
  - "Apply to Store" confirmation button
- Loading state while enhancements generate
- Success/error toast after writeback completes

### Data Flow

```
Merchant selects products
    ↓
"Enhance with AI" → calls applyAiEnhancements API
    ↓
Backend: generate or fetch cached enhancements
    ↓
Return preview data to dashboard
    ↓
Merchant reviews diffs, toggles per-product
    ↓
"Apply to Store" → calls confirmAiEnhancements API
    ↓
Backend: productsV3.updateProduct() per product
    ↓
Backend: update products_cache with new content
    ↓
Done. Next sync uses matching content everywhere.
```
