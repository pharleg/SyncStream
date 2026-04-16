# Fix Issues Wizard — Design Spec

## Overview

A step-by-step wizard that walks merchants through resolving GMC/Meta compliance errors one at a time, editing inline. Every save writes back to Wix immediately — Wix is the source of truth. Fixes that satisfy GMC/Meta requirements also improve the Wix storefront directly.

The wizard is available from two entry points:
- **Setup flow**: after the first sync, when `totalErrors > 0`, the SetupModeView shows a "Fix Issues" button
- **Products tab**: a "Fix Issues" button in the error summary area, scoped to products with errors

The wizard replaces the dashboard content panel (not a modal). An "Exit wizard" escape hatch is always visible; any fixes already saved persist regardless of early exit.

---

## Two-Phase Structure

### Phase 1 — Fix Once, Apply to All

Addresses fields where a single value resolves errors across many products. Runs before per-product work to maximize bulk impact.

**Candidate fields** (shown only if errors for that field exist):
- `brand` — one brand name for the whole store
- `condition` — store-wide default (pre-filled as "new")

**Save behavior:**
1. Writes the value to `AppConfig.fieldMappings` as a store-level default
2. Batch-updates all affected Wix products via `updateProduct`
3. Marks those products' field errors resolved in SyncStream sync state

If no Phase 1 fields have errors, Phase 1 is skipped entirely.

### Phase 2 — Per-Product Fixes

Iterates through products that still have errors after Phase 1, **depth-first**: all issues for product N are exhausted before moving to product N+1.

Within a product, issues are shown one at a time. The merchant fixes or skips each, then the wizard advances to the next issue for the same product, then the next product.

**Skip behavior:**
- "Skip this issue" — skips the current issue, stays on the same product
- "Skip this product" — skips all remaining issues for the current product, advances to next

---

## Per-Step UI

Each wizard step is a card with:

1. **Phase tabs** at the top (Phase 1 / Phase 2), showing done/active/pending state
2. **Progress bar + counter** — "Product 3 of 12" for Phase 2; "Step 2 of 3" for Phase 1
3. **Step card**:
   - Product mini-card (image, name, price, stock) — Phase 2 only
   - Google's exact error message, quoted verbatim from `errorLog`
   - Fix input (field-type-appropriate, see below)
   - "✓ Saves here and writes back to your Wix product automatically" note
4. **Footer**: primary action ("Save & Next →") + skip action

### Fix Input Types

| Field | Input |
|-------|-------|
| `description` | Textarea + "Write with SyncStream" button |
| `title` | Text input + "Write with SyncStream" button |
| `brand` | Text input (pre-filled from Phase 1 value if set) |
| `condition` | Select: new / refurbished / used |
| `imageLink` | Read-only note + "Edit in Wix →" link (images cannot be edited inline) |
| All others | Text input |

### SyncStream AI Generation

For description and title fields, a "Write with SyncStream" button generates a suggestion based on the product name, price, and category. The suggestion appears in a read-only preview area above the input. The merchant can:
- Accept it as-is (populates the input field)
- Edit it before saving
- Ignore it and type their own

The suggestion is never saved automatically — the merchant always hits "Save & Next →" to commit.

---

## Save Behavior

Every save in the wizard:
1. Calls `updateProduct` on the Wix Stores API with the corrected field value
2. Updates SyncStream's sync state to clear the resolved error
3. Advances the wizard to the next step

Wix is the source of truth. There is no SyncStream override layer between the wizard and GMC/Meta — the next sync reads from Wix and pushes the corrected value downstream.

The AI suggestion staging area (`enhancedDescription`, `enhancedTitle` in the enhanced content store) is only a temporary holding area while the merchant is reviewing. Once saved, the value lives in Wix.

---

## Entry and Exit

**Entry from setup flow:**
- SetupModeView "Fix Issues" button launches wizard
- On wizard completion or exit, returns to SetupModeView (which re-evaluates error count)

**Entry from Products tab:**
- "Fix Issues" button in error summary launches wizard
- Wizard is scoped to products with errors at launch time
- On completion or exit, returns to Products tab

**Exit wizard:**
- Always-visible "Exit wizard" link in the wizard header
- Saves already committed to Wix persist
- No confirmation dialog needed (saves are immediate, not staged)

---

## Data Sources

| Data needed | Source |
|-------------|--------|
| Products with errors | `GET /api/products` — filter by `syncStatus.status === 'error'` |
| Error messages per product | `syncStatus.errorMessages[]` on each product |
| Issue groups (Phase 1 candidates) | `issueGroups` from `GET /api/sync-status` |
| Store brand / site name | `AppConfig` (pre-populated from Wix `getSiteInfo()`) |
| AI description generation | Existing `/api/enhance-description` endpoint |
| Write fix to Wix | Existing `POST /api/compliance-apply-wix` endpoint |

---

## State Management

The wizard maintains local React state:
- `currentPhase: 1 | 2`
- `phase1Steps: Phase1Step[]` — derived from `issueGroups` at wizard launch
- `currentPhase1Index: number`
- `phase2Products: ProductWithErrors[]` — products with errors, sorted by error count desc
- `currentProductIndex: number`
- `currentIssueIndex: number` — index within the current product's error list

No wizard state is persisted between sessions. If the merchant exits and re-enters, the wizard re-derives its step list from current error state — already-fixed products won't appear.

---

## Edge Cases

- **All errors resolved during wizard**: wizard shows a completion screen, then returns to entry point
- **Product errors resolve via Phase 1**: those products are removed from Phase 2 queue automatically
- **Image errors**: shown as a step with a "Edit in Wix →" link; counts as skipped for progress purposes if merchant doesn't click through
- **AI generation fails**: textarea remains empty; merchant can still type manually; no error blocking progress
- **Wix update fails on save**: show inline error on the step card; merchant can retry or skip
