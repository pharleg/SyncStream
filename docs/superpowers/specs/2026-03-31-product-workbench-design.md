# Product Workbench Design

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Replace Sync Status tab with Dashboard landing page, add Products workbench tab for browsing, filtering, previewing rules, AI enhancement, and syncing.

---

## Tab Structure

```
Connect | Dashboard | Products | Field Mapping | Settings
```

- **Dashboard** (new, replaces Sync Status, default landing tab): Sync summary cards, last sync timestamp, "Sync Now" button, recent sync records table.
- **Products** (new): Product workbench — the central place for merchants to manage, preview, enhance, and sync products.
- Connect, Field Mapping, Settings remain unchanged.

---

## Dashboard Tab

Relocates existing Sync Status content into the first tab the merchant sees. No new backend logic.

**Content:**
- Summary cards: Total Synced, Total Errors, Total Pending
- Last full sync timestamp
- "Sync Now" button (triggers existing `/api/sync-trigger`)
- Recent sync records table (from existing `/api/sync-status`)

---

## Products Tab — Workbench

### Product Cache

Products are cached in Supabase, not fetched live from Wix on every page load. Cache starts empty. Merchant explicitly triggers "Pull Products" to populate.

**Supabase table: `products_cache`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| instance_id | text | NOT NULL |
| product_id | text | NOT NULL |
| name | text | NOT NULL |
| image_url | text | First product image URL |
| price | text | Formatted price string |
| currency | text | Default 'USD' |
| availability | text | IN_STOCK, OUT_OF_STOCK, etc. |
| variant_count | integer | Default 1 |
| description | text | Raw description |
| plain_description | text | HTML-stripped description |
| brand | text | Brand name if available |
| slug | text | Product URL slug |
| product_data | jsonb | Full WixProduct JSON for pipeline use |
| cached_at | timestamptz | Default now() |

Unique constraint on `(instance_id, product_id)`.

### Workbench UI

**Empty state:** "No products loaded. Click Pull Products to fetch your store catalog."

**Header bar:**
- "Pull Products" button — fetches from Wix SDK, populates cache, shows count
- "Last refreshed: {timestamp}" indicator
- "Sync Products" button — syncs all visible (filtered) products through the full pipeline
- "Generate AI Descriptions" button — bulk action for selected products

**Product table columns:**

| Column | Content |
|--------|---------|
| Checkbox | Multi-select for bulk actions |
| Image | Thumbnail from image_url |
| Title | Product name |
| Price | Formatted price |
| Availability | Badge (IN_STOCK = green, OUT_OF_STOCK = red) |
| Variants | Count |
| Description | Original description, truncated with expand |
| AI Description | Enhanced description if generated, "—" if not |
| Sync Status | Badge from SyncState (synced/error/pending/—) |
| Actions | "Generate AI" button per row |

### Filtering

**Preview button model** — filters are not live. Merchant configures a filter, clicks Preview, then sees results.

**Filter bar (above table):**
- Field dropdown (name, price, availability, brand, variant_count, description)
- Operator dropdown (equals, not_equals, contains, greater_than, less_than)
- Value input
- "Preview" button — applies filter client-side to the cached products table
- "Pin Filter" button — saves the current filter configuration to `sync_filters` via `POST /api/filters`. Becomes a permanent sync filter that executes during the pipeline.

**Active pinned filters** shown as removable chips/badges above the table. Removing a chip calls `DELETE /api/filters?id={id}`.

Filtering is client-side against the cached product data. The product_data JSON column provides access to nested fields for dot-path filtering.

### Rules Preview

**Preview button model** — rules are not applied live.

- "Preview Rules" button in the toolbar
- Fetches active rules from `GET /api/rules`
- Applies rules to the cached products client-side (or via a server endpoint) and shows before/after in the table
- Title and description columns show "Original → Transformed" format when preview is active
- "Clear Preview" button to revert to original view
- Rules are still managed in Field Mapping > Rules sub-tab. The workbench just previews their effect.

**Implementation:** Server-side preview via `POST /api/products/preview-rules`. Sends cached product IDs, receives transformed versions. Avoids duplicating the rules engine in the frontend.

### AI Enhancement

**Per-product:**
- "Generate AI" button in the Actions column per row
- Calls `POST /api/enhance` with single productId
- Result appears in the AI Description column
- Original description stays visible for side-by-side comparison

**Multi-select bulk:**
- Checkboxes on rows, select multiple (or "Select All")
- "Generate AI Descriptions" button in toolbar processes selected products
- Progress indicator during bulk generation
- Results populate the AI Description column as they complete

**Cache behavior:**
- Uses existing `enhanced_content` table with source hash invalidation
- Won't re-generate if product content hasn't changed since last generation
- "Regenerate" option available per product to force new generation

### Sync from Workbench

- "Sync Products" button syncs all currently visible (post-filter) products
- Uses the full existing pipeline: filter → flatten → enhance → map → rules → validate → push
- Pipeline pulls product data from `products_cache.product_data` JSON instead of live Wix API
- Results update:
  - Sync Status column in the workbench table
  - Dashboard summary cards
  - SyncState records in Supabase

---

## New Backend

### productCache.ts

Pure data module for products_cache CRUD. Called by API endpoints and syncService.

**Functions:**
- `pullProducts(instanceId)` — fetches all products from Wix SDK, upserts to products_cache, returns count
- `getCachedProducts(instanceId)` — returns all cached products for an instance
- `getCachedProduct(instanceId, productId)` — returns single cached product

### dataService.ts additions

- `upsertCachedProducts(products[])` — bulk upsert to products_cache
- `getCachedProducts(instanceId)` — query products_cache
- `getCachedProductsByIds(instanceId, productIds[])` — query by IDs

### syncService.ts changes

- `syncFromCache(instanceId, productIds[], platforms[])` — new function that reads from products_cache instead of calling Wix SDK. Uses `product_data` JSON to reconstruct WixProduct objects. Runs the same pipeline (filter → flatten → enhance → map → rules → validate → push).

---

## New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/products` | GET | Fetch cached products for workbench table. Returns products_cache rows + joined enhanced_content (AI descriptions) + joined sync_state (sync status). |
| `/api/products/pull` | POST | Pull products from Wix SDK into cache. Returns `{ count, cachedAt }`. |
| `/api/products/preview-rules` | POST | Body: `{ productIds }`. Applies active rules to specified cached products server-side. Returns array of `{ productId, original: { title, description }, transformed: { title, description } }`. |
| `/api/products/sync` | POST | Body: `{ productIds, platforms }`. Syncs specified cached products through the full pipeline. Returns BatchSyncResult. |
| `/api/products/enhance` | POST | Body: `{ productIds }` or `{ productId }`. Generates AI descriptions for specified products. Returns enhanced content. |

---

## Dashboard Tab Changes

### sync-stream.tsx modifications

- Rename `StatusTab` → `DashboardTab`
- Move it to first position in TAB_ITEMS (after Connect)
- Set `activeTab` default to `'dashboard'`
- Add `ProductsTab` component for the workbench
- Remove old `'status'` tab ID, replace with `'dashboard'`

### TAB_ITEMS becomes:

```typescript
const TAB_ITEMS = [
  { id: 'connect', title: 'Connect' },
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'products', title: 'Products' },
  { id: 'mapping', title: 'Field Mapping' },
  { id: 'settings', title: 'Settings' },
];
```

---

## Data Flow

```
Pull Products:
  Merchant clicks "Pull Products"
  → Wix SDK fetch (paginated)
  → Upsert to products_cache
  → Table renders from cache

Preview Filter:
  Merchant configures filter → clicks "Preview"
  → Client-side filter on cached data
  → Table updates to show matching products
  → "Pin Filter" saves to sync_filters

Preview Rules:
  Merchant clicks "Preview Rules"
  → POST /api/products/preview-rules
  → Server applies rules engine to cached products
  → Table shows before/after columns

Generate AI:
  Merchant clicks "Generate AI" (per-product or bulk)
  → POST /api/products/enhance
  → Server checks enhanced_content cache (source hash)
  → Generates via Claude API if stale/missing
  → Saves to enhanced_content
  → AI Description column updates in table

Sync from Workbench:
  Merchant clicks "Sync Products"
  → POST /api/products/sync with visible product IDs
  → Server reads product_data from products_cache
  → Runs full pipeline (filter → flatten → enhance → map → rules → validate → push)
  → Updates SyncState
  → Table Sync Status column updates
  → Dashboard summary cards update on next visit
```
