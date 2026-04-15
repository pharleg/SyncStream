# UX Polish, Backflow, and AI Integration Design

**Date:** 2026-04-14
**Scope:** Products tab restructure, Apply to Wix/GMC fix, AI-compliance integration
**Goal:** Polish the dashboard UX and complete the compliance fix pipeline before Meta integration

---

## Context

The Products tab currently does too much in a single view: filtering, rules preview, AI enhancement, compliance checking, fix staging, and platform targeting all compete for space in one scrollable pane. The compliance fix pipeline is partially broken (Apply to Wix ignores all fields except title/description; Apply to GMC is a stub). AI descriptions work well in isolation but are disconnected from compliance. This spec addresses all three in three sequential phases.

---

## Phase 1: Products Tab Sub-tab Restructure

### Structure

The existing top-level tabs (Connect, Dashboard, Products, Field Mapping, Settings) stay unchanged. Inside the **Products** tab, a nested WDS `Tabs` component splits the content into three sub-tabs:

**Products**
- Search/filter bar (name, status, platform filter dropdowns)
- Product table with: name, image thumbnail, sync status, platform targeting badges, GMC override badge
- Platform toggle column (GMC / Meta badges, clickable)
- GMC override badge: shows count of active overrides per product (e.g. "2 GMC overrides"); clicking opens a popover listing which fields are overridden with current values and a "Clear" option per field

**Compliance**
- Health score card with "Check Now" button
- Per-product expandable issue rows (errors + warnings)
- Inline Fix/Undo editing for each issue
- Pending fixes banner (shown when `pendingFixes` is non-empty)
- Apply to Wix / Apply to GMC action buttons

**AI**
- Style/tone input at the top (currently in Settings — moves here)
- Toolbar: "Enhance Selected" button (defaults to all products when nothing selected) + "Enhance All" button
- Side-by-side before/after preview cards with accept/reject toggles per product
- "Apply to Store" button at the bottom of the preview

### Implementation notes

- `sync-stream.tsx` is not split into separate files in this phase — the file stays monolithic but state blocks get clearly commented by sub-tab (e.g. `// --- COMPLIANCE STATE ---`)
- The tab-change warning for uncommitted fixes (`_hasPendingFixes`) stays at the top-level Products tab boundary, not the Compliance sub-tab boundary — leaving Products entirely should warn, switching between sub-tabs should not
- Style/tone setting moves from the Settings tab to the AI sub-tab; the Settings tab retains the "Enhance All Descriptions" bulk action and enhanced product count display

---

## Phase 2: Apply to Wix + Apply to GMC

### Apply to Wix

**What it does:** Writes `title` and `description` fixes back to Wix products. All other staged fix fields (`brand`, `condition`, `link`, `imageLink`, `offerId`) are silently skipped — those are GMC-only overrides.

**New endpoint:** `src/pages/api/compliance-apply-wix.ts`
- Accepts: `{ fixes: { productId, field, value }[] }`
- Filters to only `title` and `description` fields
- For each product, fetches current revision from Wix Stores V3 API
- Patches `name` (from `title`) and `plainDescription` (from `description`, wrapped in `<p>` tags)
- Returns per-product `{ productId, success, error? }`
- Do not reuse `/api/products-apply-ai` — that endpoint is for AI-generated content only

**Frontend:** On success, clears the applied fixes from `pendingFixes` state and shows a success toast. Failed products show inline error messages.

### Apply to GMC

**What it does:** Stores field overrides for GMC-eligible fields (`brand`, `condition`, `link`, `imageLink`) in Supabase, then triggers an immediate targeted sync for affected products. Overrides persist and apply on all future syncs.

**New Supabase table:** `gmc_field_overrides`
```sql
CREATE TABLE gmc_field_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  field_name text NOT NULL,
  override_value text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, field_name)
);
CREATE INDEX idx_gmo_product_id ON gmc_field_overrides (product_id);
```

**New endpoint:** `src/pages/api/compliance-apply-gmc.ts`
- Accepts: `{ fixes: { productId, field, value }[] }`
- Filters to GMC-eligible fields only
- Upserts into `gmc_field_overrides`
- Triggers targeted sync for affected `productId`s (calls existing sync pipeline scoped to those IDs)
- Returns `{ success, synced: productId[] }`

**Sync pipeline integration:** `productMapper.ts` `mapFlattenedToGmc()` fetches active overrides for the product from `gmc_field_overrides` (via a new `dataService` helper `getGmcOverrides(productId)`) and merges them over the mapped attributes before returning. Overrides win over mapped values.

**Override badge (Products sub-tab):** The product table fetches a summary of override counts per product on load (batched query). Shows a small badge "N GMC overrides" on affected rows. Clicking opens a WDS `Popover` listing field name → override value pairs, with a "Clear" button per field that deletes the row from `gmc_field_overrides` (no re-sync triggered on clear — takes effect on next sync).

---

## Phase 3: AI Integration with Compliance + AI Sub-tab Polish

### "Fix with AI" in Compliance

**Trigger:** Description and title compliance issues get a secondary "Fix with AI" button alongside the existing manual "Fix" button. Visible only when AI enhancement is enabled (checked in appConfig).

**Flow:**
1. Merchant clicks "Fix with AI" on a description or title issue
2. A loading spinner replaces the button while the AI call runs
3. `aiEnhancer.enhanceSingle(productId)` is called for that product
4. The AI result auto-populates the inline fix input field — the merchant sees the suggested value before committing
5. Merchant reviews and clicks "Stage" to accept or edits the value, or clicks "Cancel" to discard
6. No auto-staging without merchant review

**No new AI infrastructure needed** — this reuses the existing `aiEnhancer` single-product path.

### AI Sub-tab Polish

**Layout (top to bottom):**
1. Style/tone input (moved from Settings)
2. Toolbar: "Enhance Selected" (defaults to all when nothing selected) | "Enhance All"
3. Preview area: side-by-side before/after cards, one per product
   - Card header: product name
   - Before column: current title + description
   - After column: AI-suggested title + description (editable)
   - Accept/reject checkbox per product
4. "Apply to Store" button — writes accepted enhancements to Wix products

**Visual fixes:**
- Description text size: `size="tiny"` → `size="small"` throughout
- Preview card max-height: increase from `600px` to `80vh`
- Consistent button sizes: all toolbar buttons `size="small"`, "Apply to Store" default size

---

## Data Model Summary

### New Supabase table
```
gmc_field_overrides (id, product_id, field_name, override_value, updated_at)
```

### New API endpoints
- `src/pages/api/compliance-apply-wix.ts` — title/description → Wix V3
- `src/pages/api/compliance-apply-gmc.ts` — brand/condition/link/imageLink → DB + targeted sync

### Modified files
- `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` — sub-tab structure, state reorganization, AI sub-tab, compliance "Fix with AI" button, override badge
- `src/backend/productMapper.ts` — apply `gmc_field_overrides` during mapping
- `src/backend/dataService.ts` — `getGmcOverrides()`, `clearGmcOverride()`, `getBatchOverrideCounts()`
- `src/backend/aiEnhancer.ts` — export single-product enhance for compliance use

---

## Out of Scope

- Meta integration (Phase 4 — explicit decision to defer)
- File-level split of `sync-stream.tsx` into sub-components (would be a follow-up refactor)
- GMC override history / audit log
- Compliance report export
