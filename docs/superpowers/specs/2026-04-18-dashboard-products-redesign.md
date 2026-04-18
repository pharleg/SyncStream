# Dashboard & Products Tab Redesign

## Goal

Replace the current multi-sub-tab dashboard and products layout with a unified, information-dense design that makes feed health, sync failures, and compliance issues undeniable and immediately actionable from the top-level tabs.

## Problem Statement

The existing UI has two compounding issues:

1. **Dashboard** shows minimal state — merchants can't tell at a glance how many products are failing or why. Feed health is not surfaced per platform.
2. **Products tab** has three sub-tabs (Products, Compliance, AI) that fragment information. A product's sync status, compliance errors, and AI toggle are spread across separate screens. Most critically, failed products appeared green with no visible error reason due to a product ID mismatch bug (now fixed in the sync layer).

## Approved Design

### Dashboard Tab

**Layout: stats row → feed health card → action buttons → two-column activity/issues**

#### Stat Cards Row (4 cards)
| Card | Value | Color |
|---|---|---|
| Total Products | count of all catalog products | neutral |
| Synced | count with status = synced | green |
| Failed | count with status = error | red |
| Warnings | count with warning-level flags (e.g. no SKU) | amber |

Cards are always visible — failures cannot be hidden or appear green.

#### Feed Health Card
Two progress bars, one per connected platform (GMC, Meta):
- Label: platform name
- Bar: fills to `synced / total` percentage
- Percentage displayed numerically alongside bar
- Sub-text: "N of M products passing · K errors"
- Only shows bars for platforms that are connected in AppConfig

#### Action Buttons Row
Three buttons, left to right:
1. **Sync Now** (primary blue) — triggers full sync
2. **Fix Issues (N)** (amber) — navigates to Products tab with "Failed" filter pre-selected; N = failed count; hidden if 0 failures
3. **Check Compliance** (secondary blue) — triggers compliance check without initiating a sync

#### Two-Column Section
Left column — **Recent Activity feed**:
- Shows last ~10 sync events in reverse chronological time
- Each row: colored dot + message + relative timestamp
- Dot colors: green = success, red = failure, blue = info (compliance check, etc.)
- Messages are human-readable: "19 products synced to GMC", "11 products failed — missing brand field"

Right column — **Top Issues panel**:
- Aggregates validation errors across all products
- Groups by issue type, shows count: "Missing brand (8 products)"
- Each row has an error/warning badge
- Maximum 6 rows shown; "View all →" link navigates to Products tab
- Sorted by severity (errors first) then count descending

---

### Products Tab

**One unified table — no sub-tabs.** The Products, Compliance, and AI sub-tabs are removed entirely.

#### Toolbar
- **Filter tabs** (pill style): All (N) · Failed (N) · Warnings (N) · Synced (N) — counts update after each sync/compliance check
- **Search box** — filters product name and SKU inline
- **Check All button** — runs compliance check on all products, no sync
- **Sync Now button** — triggers full sync

#### Product Table

Columns:
| Column | Content |
|---|---|
| Thumbnail | 32×32px product image from `product.media.mainMedia.image.url`; grey placeholder if missing |
| Product | Name (bold), SKU or "No SKU" (muted), inline issue list (see below) |
| GMC | Status chip: ✓ Synced / ✕ Failed / ⚠ Warning / — Not synced |
| Meta | Same status chips |
| SyncStream AI | Toggle (on/off) + label ("Enhanced" / "Off") |
| Action | "Fix" link (red) if errors exist, "›" expand chevron otherwise |

**Inline issue list** (under product name, only shown when issues exist):
- Each issue is one line: icon + message
- Error (✕, red): "Missing brand", "Description too short (<20 chars)", "Missing image"
- Warning (⚠, amber): "No SKU — fallback ID in use", "Description may be too generic"
- Row background tints: errors = very light red (`#fffbfb`), warnings = very light amber (`#fffdf5`), clean = white

#### Expanded Row (Fix Panel)

Clicking "Fix" or "›" expands the row in-place below the row. Three-column layout:

**Column 1 — Fix Inputs:**
- Title: "Fix Issues"
- One labeled input per fixable field with current value pre-populated
- Fixable fields: brand, description, title, condition, link, imageLink, offerId/SKU
- Only fields with active errors/warnings are shown as inputs; other fields shown as read-only
- Three apply buttons: "Apply to Wix" · "Apply to GMC" · "Apply Both"
- Apply to Wix: writes the corrected value back to the Wix product via the existing writeback mechanism
- Apply to GMC: stores as a GMC field override for next sync (does not touch the Wix product)
- Apply Both: does both

**Column 2 — Current Feed Values:**
- Read-only display of all mapped fields for this product as they would be sent to GMC/Meta
- Fields: title, description snippet, price, availability, condition, brand, image thumbnail
- Helps merchant verify what is actually being pushed before/after a fix

**Column 3 — SyncStream AI:**
- Per-product AI toggle (on = auto-enhance on next sync, off = skip)
- "Enhance This Product" button — runs AI enhancement immediately and shows result
- Short status line: last enhanced timestamp, or "Not enhanced yet"
- If toggle is off: "Toggle on to auto-enhance on next sync"

Only one row expanded at a time. Clicking a second row collapses the first.

Tab-change warning: if any fix inputs have unsaved changes (not yet applied), show a confirmation dialog before navigating away.

---

## Data Requirements

### Dashboard stat counts
Computed from existing `sync_state` table:
- `total`: product count from cached products
- `synced`: `COUNT WHERE status = 'synced'`
- `failed`: `COUNT WHERE status = 'error'`
- `warnings`: derived from validation warnings stored in `errorLog` with `severity = 'warning'`

Feed health percentage: `synced / total * 100` per platform.

### Top Issues aggregation
Run server-side: group `errorLog` entries across all sync states by `field` + `message`, count occurrences, return top N sorted by (severity desc, count desc).

New backend function: `getTopIssues(instanceId, platform, limit)` → `Array<{ field, message, severity, count }>`.

### Recent Activity
New Supabase table: **`sync_events`**
```
id          uuid primary key default gen_random_uuid()
instance_id text not null
event_type  text not null  -- 'sync_complete' | 'sync_error' | 'compliance_check' | 'manual_fix'
message     text not null
severity    text not null  -- 'success' | 'error' | 'info' | 'warning'
product_count int
created_at  timestamptz default now()
```

Written by `syncService.ts` at end of each sync run (one event per run, not per product). Written by compliance check and manual fix apply operations.

New backend function: `getRecentEvents(instanceId, limit)` → `SyncEvent[]`.

### Filter tab counts
Computed client-side from the already-loaded products array after each sync/check — no extra API call.

### Products API
The existing `/api/products` endpoint already returns `syncStatus` per product. It needs to also return:
- `enhancedTitle`, `enhancedDescription` (already returned)
- `aiEnabled` boolean (from `sync_state.ai_enabled` or `app_config` default)

New field on `sync_state`: `ai_enabled boolean default true` — controls per-product AI enhancement.

---

## Component Architecture

The current `sync-stream.tsx` is a 2,800-line monolith. This redesign extracts the two most complex tabs into focused components, imported into the main file.

### New files

**`src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx`**
Props: `{ instanceId, stats, healthData, topIssues, recentEvents, onSyncNow, onCheckCompliance, onNavigateToFailed }`
Renders: stat cards, health card, action buttons, activity feed, issues panel.
No internal data fetching — all data passed as props from parent.

**`src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx`**
Props: `{ instanceId, products, onSyncNow, onCheckCompliance, onApplyFix, onToggleAI }`
Renders: toolbar with filter tabs + search, product table with inline issues, expanded fix panel.
Filter state (active tab, search query, expanded row) is local to this component.

**`src/extensions/dashboard/pages/sync-stream/ProductRow.tsx`**
Props: `{ product, isExpanded, onExpand, onApplyFix, onToggleAI }`
Renders: single product table row + expanded detail panel when `isExpanded`.

### Modified files

**`sync-stream.tsx`**
- Remove Products sub-tabs (Products, Compliance, AI) — replaced by `ProductsTab`
- Remove Dashboard sub-components that are now in `DashboardTab`
- Add data fetching for `topIssues` and `recentEvents`
- Pass all data as props to `DashboardTab` and `ProductsTab`
- Retain: Connect tab, Field Mapping tab, Settings tab — unchanged

**`src/backend/dataService.ts`**
- Add `getTopIssues(instanceId, platform, limit)` function
- Add `getRecentEvents(instanceId, limit)` function
- Add `upsertSyncEvent(instanceId, event)` function

**`src/backend/syncService.ts`**
- Call `upsertSyncEvent` at end of each sync run with summary counts

### New migration

**`supabase/migrations/YYYYMMDD_sync_events.sql`**
- Creates `sync_events` table
- Index on `(instance_id, created_at desc)`

---

## States & Edge Cases

### Dashboard states
The existing `getDashboardState()` logic (Fresh / Confirm Setup / Setup Mode / Normal) is preserved. The new Dashboard layout described above is the **Normal** state. The Setup Mode / FixWizard flow is not changed by this redesign.

### Empty states
- No products yet: stat cards show 0s; feed health bars show 0%; activity feed shows "No activity yet"; products table shows empty-state illustration + "Sync your catalog to get started"
- All synced, no issues: "Fix Issues" button hidden; top issues panel shows "All products healthy ✓"
- Platform not connected: GMC or Meta column shows "—" with muted text "Not connected"

### Loading states
- Products table: skeleton rows while data loads (same pattern as current)
- Dashboard stats: skeleton number placeholders
- After Sync Now click: button shows spinner; stat cards and health bars update when sync completes

### Pending fixes warning
If the user has entered values in any fix input without clicking Apply, and tries to navigate to another tab or close the row: show a confirmation: "You have unsaved fixes for [product name]. Discard them?" — Cancel keeps the panel open, Discard closes without applying.

---

## Out of Scope

- Connect tab: no changes
- Field Mapping tab: no changes
- Settings tab: no changes
- The FixWizard (used in Setup Mode): no changes
- Per-product platform targeting toggles: already implemented, carried forward as-is
- GMC override badge/popover on Products sub-tab: migrated into the unified product row expanded panel

---

## Success Criteria

1. Failed products show red status chips with visible error reasons — never appear green
2. Feed health % is visible on the Dashboard without clicking into any sub-tab
3. Merchant can go from Dashboard → failed product → apply fix → re-sync without navigating more than 2 clicks
4. Products, compliance status, and AI toggle are visible in one table row — no sub-tab switching required
5. Recent Activity and Top Issues give merchant context without requiring a sync run first
