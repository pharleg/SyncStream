# Guided Feed Setup — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

---

## Problem

When a merchant runs their first sync and all products fail validation, the current UI shows "0 synced, 18 failed out of 18 total" and a table full of ERROR badges. This reads as "the app is broken" — not "here's the one thing you need to configure." Non-technical store owners bounce instead of fixing the issue.

The root cause: validation errors (fixable config) and API errors (actual failures) are treated identically, and errors are shown per-product instead of per-issue-type.

---

## Goals

- Pull everything we can from the merchant's Wix store automatically — don't ask for what we can find
- Show a confirmation screen so the merchant knows what was auto-populated
- Make the path from "installed" to "first successful sync" feel guided, not broken
- Group validation issues by type (1 row for "brand missing") not by product (18 error rows)

---

## The Flow

This is a one-time onboarding flow triggered immediately after GMC OAuth completes.

### Step 1 — GMC OAuth (existing)
No change. After successful token exchange, instead of returning to the Connect tab idle state, automatically advance to Step 2.

### Step 2 — Confirm Setup Screen (new)
A confirmation screen shown once, right after OAuth. We pull from Wix APIs and pre-fill everything we can.

**Auto-populated fields (editable):**

| Field | Source | Notes |
|---|---|---|
| Brand Name | `@wix/site-properties` business name | Editable — merchant may want a different brand than their business name |
| Store URL | `dashboard.getSiteInfo().siteUrl` | Already pulled today; shown for confirmation |
| Default Condition | Smart default: "New" | Dropdown: New / Refurbished / Used |

**Read-only confirmation rows:**
- Products found in store (count)
- Store currency (from Wix store settings)
- Syncing to: Google Merchant Center

**Optional fields (collapsed, labeled "set later in Field Mapping"):**
- GTIN / Barcode
- Google Product Category
- MPN

**CTAs:**
- Primary: "Looks good — run first sync →" — saves all fields to AppConfig field mappings and triggers sync
- Secondary: "I'll review in Field Mapping first" — saves fields and navigates to Field Mapping tab without syncing

**Color legend on field labels:**
- Green badge: "from your Wix business name" / "from your site settings"
- Blue badge: "smart default"
- Yellow badge: "needs your input" (only shown if a required field couldn't be auto-filled)

### Step 3 — First Sync Result
After the confirmation screen triggers sync, one of two outcomes:

**All issues resolved → Ready state**
Green checklist showing all steps complete. Button reads "Sync Now — 18 Products." After clicking, transitions to normal dashboard on success.

**Issues remain → Setup Mode**
Dashboard enters setup mode. Displays a checklist of resolved and unresolved items. Issues are grouped by type with a single "Fix →" action per issue type.

---

## Dashboard States

The Dashboard tab gains awareness of where the merchant is in setup. Four states:

### State 0 — Fresh Install (pre-setup)
Shown when GMC is not yet connected or setup hasn't been completed.
- Banner: "Welcome to SyncStream — run your first sync to see how your products look to Google and Meta."
- Single CTA: "Run First Sync →"
- Stats cards show "–" (no data yet)
- Placeholder for sync history

### State 1 — Setup Mode (issues found after sync)
Shown when sync has run but all/most failures are validation errors.
- Banner: "18 products found — 1 thing to fix. Complete the steps below, then sync to go live."
- Checklist replaces error table:
  - ✓ Google Merchant Center connected
  - ✓ 18 products found in your store
  - ! Brand not configured → [Fix →] (links to Field Mapping with brand pre-focused)
- "Sync Now" button present but de-emphasized with note: "Fix issues above first for best results"

**Setup mode detection logic:** If the last sync produced zero successes AND all errors are validation errors (not API errors), show Setup Mode. If any products synced successfully OR any errors are API-level, show normal dashboard.

### State 2 — Ready
Shown when all checklist items are resolved but no successful sync yet.
- Celebratory banner: "Your feed is ready — 18 products will sync to Google on next run"
- Green "Sync Now — 18 Products" button
- Full green checklist showing all items resolved

### State 3 — Normal (post-first-success)
Existing dashboard behavior. No changes.

---

## Wix API Integration

**Business name pull:**
Use `@wix/site-properties` to fetch the site/business name and pre-populate the brand field mapping default. This is a backend call made during the OAuth callback flow (Step 2 initialization).

**Fallback:** If `@wix/site-properties` is unavailable or returns empty, show the brand field with a yellow "needs your input" badge so the merchant knows to fill it in manually.

**Site URL:** Already pulled via `dashboard.getSiteInfo().siteUrl` in the main component. Reuse this value.

---

## What Is Not Changing

- Field Mapping tab — no structural changes; the confirm screen just pre-populates values there
- Products tab and compliance workbench — untouched
- Settings tab — untouched
- Sync logic, validator, backend — no changes
- The normal dashboard (State 3) — no changes

---

## Implementation Scope

**New components/screens:**
- `ConfirmSetupScreen` — the Step 2 confirmation UI (new component in sync-stream.tsx or extracted file)
- Dashboard state detection logic — reads last sync result + setup completion flag from AppConfig

**Modified:**
- `gmc-exchange-code.ts` — after saving AppConfig, set a new `setupScreenShown: false` flag so the confirm screen fires once on next dashboard load
- `DashboardTab` — add state detection, render appropriate state (0–3)
- `AppConfig` type + Supabase `app_config` table — add `setup_screen_shown` boolean column (default false)
- `ConnectTab` — after OAuth success, navigate to Dashboard tab

**Dashboard state derivation (no extra flags needed beyond `setup_screen_shown`):**
- State 0: `gmcConnected === false` OR `lastFullSync === null` with no prior sync records
- Confirm screen: `gmcConnected === true` AND `setup_screen_shown === false`
- State 1 (Setup Mode): `setup_screen_shown === true` AND last sync had zero successes AND all errors are validation errors
- State 2 (Ready): `setup_screen_shown === true` AND compliance check passes (zero blocking issues) AND `lastFullSync === null`
- State 3 (Normal): `lastFullSync !== null` (at least one successful sync has completed)

**New API call:**
- Backend function to fetch Wix business name from `@wix/site-properties` — called during setup screen initialization

---

## Success Criteria

- A merchant who installs the app and connects GMC sees their brand name pre-filled — no manual entry required for the common case
- After completing the confirm screen and syncing, they see a success state — not an error state
- A merchant who gets validation errors sees a checklist with one "Fix →" action, not a table of 18 error rows
- The path from OAuth → confirmed setup → first successful sync requires no more than 3 clicks for a store with a business name configured in Wix
