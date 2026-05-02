# Screens Solid — Full Cleanup Design

**Date:** 2026-05-02  
**Scope:** All dashboard screens pre-App Market launch  
**Approach:** C — Full Cleanup (auth fix + WDS compliance + UX improvements)

---

## What Changes

| File | Action |
|------|--------|
| `status.tsx` + `status.extension.ts` | Delete — dead code, not in nav |
| `connect.tsx` | Fix auth, remove Meta gate, debug leak, upgrade URL |
| `settings.tsx` | Fix auth, rename labels, add AI credit estimate |
| `mapping.tsx` | Fix auth, Rules field dropdown, Add Rule UX |
| `DashboardTab.tsx` | WDS: LinearProgressBar, skins, remove hardcoded hex |
| `ProductsTab.tsx` | WDS: SegmentedToggle, SectionHelper, remove hardcoded hex |

No new pages. No new API routes except one small addition to `/api/enhance` GET.

---

## Auth Fix (settings.tsx + mapping.tsx)

Both files currently use raw `fetch()` — unauthenticated calls that bypass Wix instance validation.

**Fix:** Add a local `appFetch` helper at the top of each file (mirrors `connectFetch` in connect.tsx):

```ts
function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, new URL(import.meta.url).origin).toString();
  return httpClient.fetchWithAuth(url, init);
}
```

All `fetch('/api/...')` calls switch to `appFetch('/api/...')`. Remove `instanceId: 'default'` from all request bodies — the backend reads instanceId from the Wix auth token.

---

## connect.tsx

### Debug leak
Error shown to users: remove `debug_instanceId` and Supabase state. Replace with:
```
"Google Merchant Center connection failed. Please try again."
```

### Meta card — remove plan gate
Remove the `plan !== 'free'` conditional entirely. Both GMC and Meta cards always visible to all users. Meta is available on Free plan (same 50-product limit as GMC).

Remove `callGetBillingStatus` from the initial `Promise.all` — no longer needed on connect page.

### Meta card — pre-T-001 state
While Meta OAuth is not yet wired (T-001 not shipped), Meta card shows a "COMING SOON" badge instead of a disabled button:

```tsx
// suffix when not connected and OAuth not wired:
<span style={{ /* WDS Badge approximation */ }}>COMING SOON</span>

// suffix when not connected and OAuth wired (T-001 done):
<Button size="small" onClick={handleConnectMeta}>Connect</Button>

// suffix when connected:
<Text size="small" skin="success" weight="bold">Connected</Text>
```

Use a feature flag or env variable to toggle between badge and real button when T-001 ships — no second deploy needed.

### Upgrade URL
Replace `window.open('https://manage.wix.com/app-market', '_blank')` with a shared constant:

```ts
// src/lib/constants.ts (new file)
export const UPGRADE_URL = 'https://manage.wix.com/upgrade';
```

Used in connect.tsx, DashboardTab.tsx, ProductsTab.tsx. One place to update if Wix changes the URL.

---

## settings.tsx

### Auth
Apply `appFetch` pattern described above.

### Rename labels
- "Run Full Sync" button → **"Sync to Channels"** (matches main dashboard)
- "Style / Tone (optional)" label → **"Description Tone (optional)"**

### AI Enhancement card — credit estimate
Add pending count + credit estimate below the Enhance All button:

```
Enhance All Descriptions    [button]
24 products pending · uses 24 AI credits
18 already enhanced
```

**Data source:** `/api/enhance` GET currently returns `{ enhancedCount }`. Add `totalCount` to the response. Client computes `pending = totalCount - enhancedCount`. Credits used = pending (1 credit = 1 enhancement).

### Keep all 4 cards
Manual Sync card stays — renamed button only. All cards: Auto Sync, Connected Platforms, AI Enhancement, Manual Sync.

---

## DashboardTab.tsx

### Feed health progress bars
Replace raw `<div>` progress bars with WDS `LinearProgressBar`. Bar skin is dynamic:
- `health.errors === 0` → `skin="success"` (green)
- `health.errors > 0` → `skin="warning"` (yellow)

Matches the Fix Issues button color — both signal "attention needed" together.

### Fix Issues button
Remove inline style hack (`color: '#c17d00', borderColor: '#f5d67a', background: '#fff8e1'`). WDS `Button` has no warning skin — use `skin="light"`. The progress bar already signals yellow; the button doesn't need to duplicate the color.

### Stat card numbers
Replace `style={{ color, fontSize: 24 }}` with WDS `Text` skins:
- Failed count → `skin="error"`
- Warnings count → `skin="warning"`  
- Synced count → `skin="success"`
- Total → default

### Activity feed severity dots
Replace raw `<span style={{ background: severityDotColor(...) }}>` with WDS `Badge` using skin mapped from severity: `success → "success"`, `error → "danger"`, `warning → "warning"`, `info → "standard"`. Remove `severityDotColor` function entirely.

### Issue severity pills
Replace hardcoded `fce8e8/c62828` and `fff8e1/c17d00` inline styles with WDS `Badge skin="danger"` and `Badge skin="warning"`.

### Billing banner
Replace inline styles with WDS `SectionHelper` (matches ProductsTab treatment).

---

## ProductsTab.tsx

### Filter tabs
Replace raw `<button>` elements + `filterTabStyle` function with WDS `SegmentedToggle`. Remove the entire `filterTabStyle` function and all hardcoded hex color logic.

### Table header
Replace CSS `display:grid` with manual pixel columns + raw `<Text>` spans. Use WDS `Table` component with proper column definitions. ProductRow already renders inside the list — wire it as `Table.Content` rows.

### Billing banner (syncBlocked)
Replace inline-styled warning box with WDS `SectionHelper appearance="warning"` with title "Catalog limit reached" and body explaining the limit + Upgrade button.

### Remove hardcoded hex
All `#3db37a`, `#e53935`, `#f5a623`, `#116dff`, `#32536a`, `#7a92a5` etc. removed. Use WDS `Text skin`, `Badge skin`, or standard WDS color tokens.

---

## mapping.tsx

### Auth
Apply `appFetch` pattern. Remove all `instanceId: 'default'` from request bodies.

### Rules — Target Field dropdown
Replace free-text `Input` for "Target Field" with a platform-aware `Dropdown`:

**Both / GMC options:**
`title`, `description`, `price`, `salePrice`, `brand`, `condition`, `gtin`, `mpn`, `googleProductCategory`, `imageLink`, `availability`

**Meta-only options:**
Same minus `googleProductCategory`, plus `retailer_id`

Dropdown options filtered based on the selected Platform value. Prevents silent typo failures.

### Add Rule UX
Remove the toggle behavior (Add Rule button currently opens AND closes the form). New pattern:
- "Add Rule" button: always opens form (disabled when form is open)
- Separate "Cancel" text link inside the form closes it

Same fix applied to Add Filter.

### Type: expression
Replace `expression: any` in `SyncRule` type with a proper discriminated union:

```ts
type RuleExpression =
  | { type: 'static'; value: string }
  | { type: 'concatenate'; parts: Array<{ type: 'field' | 'literal'; value: string }> }
  | { type: 'calculator'; field: string; operator: '+' | '-' | '*' | '/'; operand: number };
```

---

## API Changes

| Endpoint | Change |
|----------|--------|
| `GET /api/enhance` | Add `totalCount: number` to response alongside existing `enhancedCount` |

No other API changes.

---

## Business Decisions Captured

| Decision | Value |
|----------|-------|
| Meta available on Free plan | Yes — same 50-product limit as GMC |
| Pro plan price | $25/month (was $19 on website — needs updating in separate repo) |
| Free AI credits/month | 25 |
| Pro AI credits/month | 500 |
| 1 credit = | 1 product enhancement |
| Enhancement model | `claude-haiku-4-5-20251001` |
| Cost at 500 Pro credits | ~$0.90/month |

---

## Out of Scope

- FixWizard.tsx, ProductRow.tsx, sync-stream.tsx — no changes
- Website pricing page ($19 → $25) — separate repo, separate task
- Meta OAuth implementation — T-001
- Billing plan wiring — T-003
