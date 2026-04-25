# OAuth Permanent Fix + Monetization Design

**Date:** 2026-04-24  
**Status:** Approved

---

## 1. Scope

Two features:

1. **GMC OAuth permanent fix** — replace manual auth-code copy flow with real redirect callback
2. **Monetization** — Free / Pro subscription tiers via Wix Pricing Plans + AI credit enforcement

---

## 2. GMC OAuth Permanent Fix

### Problem

`gmc_redirect_uri` secret currently points to `editorx.io` (intentional 404). Merchant must manually copy the `?code=` param from the URL bar, then paste it into the app. `gmc-exchange-code.ts` handles that manual exchange.

The proper callback handler (`/api/gmc-oauth-callback`) already exists and works correctly.

### Fix

1. Run `wix release` to get the deployed URL for the app's API routes
2. Register `/api/gmc-oauth-callback` at that URL as an authorized redirect URI in Google Cloud Console
3. Update `gmc_redirect_uri` secret to match the deployed URL
4. Delete `src/pages/api/gmc-exchange-code.ts` — manual flow no longer needed
5. Remove the outdated comment from `gmc-oauth-init.ts`

No code changes to `oauthService.ts` or `gmc-oauth-callback.ts` — they already implement the correct flow.

---

## 3. Monetization

### 3.1 Plan Tiers

| Feature | Free | Pro |
|---|---|---|
| Products synced | 50 | Unlimited |
| AI credits | 25 / month | 500 / month |
| Platforms | GMC only | GMC + Meta |
| Price | $0 | TBD |

- "Products synced" = parent products (not variants)
- AI credits = per unique description generated; variants sharing a description = 1 credit
- Both tiers reset credits monthly on billing anniversary

### 3.2 Wix Pricing Plans

Two plans defined in Wix App Dashboard (`@wix/pricing-plans`):
- **Free** — $0, recurring monthly, auto-assigned on app install
- **Pro** — $X/month, recurring

Wix webhook events handled by a new `/api/billing-webhook` endpoint:

| Event | Action |
|---|---|
| `plan.activated` | Upsert `credit_balance` row with tier quota, set `reset_date = now + 30d` |
| `plan.renewed` | Reset `credits_remaining` to tier quota, update `reset_date` |
| `plan.cancelled` | Downgrade to Free limits at next reset |

**Free plan initialization:** No webhook needed. `billingService` lazily creates the `credit_balance` row with Free defaults (`plan_tier = 'free'`, `credits_remaining = 25`, `reset_date = now + 30d`) on first call if no row exists for that `instanceId`.

`AppConfig` gains: `planTier: 'free' | 'pro'`

### 3.3 Supabase — `credit_balance` table

```sql
CREATE TABLE credit_balance (
  instance_id       TEXT PRIMARY KEY,
  plan_tier         TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  credits_remaining INT  NOT NULL DEFAULT 25,
  reset_date        TIMESTAMPTZ NOT NULL
);
```

### 3.4 `billingService.ts` — enforcement layer

New file. Single source of truth for all billing checks.

```typescript
getPlan(instanceId): Promise<'free' | 'pro'>
checkSyncLimit(instanceId, productCount): Promise<void>  // throws BillingError if free + count > 50
checkPlatformAccess(instanceId, platform): Promise<void> // throws BillingError('PLATFORM_NOT_AVAILABLE') if free + platform === 'meta'
deductCredit(instanceId): Promise<void>                  // throws BillingError if credits_remaining === 0
getCreditBalance(instanceId): Promise<{ remaining: number; resetDate: Date }>
```

`BillingError` — typed error with `code: 'SYNC_LIMIT_REACHED' | 'NO_CREDITS'`. API layer returns HTTP 402 on these so the frontend can show the correct upgrade prompt.

Monthly auto-reset: `deductCredit` and `getCreditBalance` check `reset_date` on every call. If `now > reset_date`, reset balance to tier quota before proceeding. No cron job needed.

### 3.5 Gate points

| Location | Gate |
|---|---|
| `syncService.ts` | `checkSyncLimit(instanceId, productCount)` before pushing batch |
| `syncService.ts` | `checkPlatformAccess(instanceId, platform)` before pushing to any platform |
| `aiEnhancer.ts` | `deductCredit(instanceId)` before calling Claude API |

### 3.6 New API endpoints

- `GET /api/billing-status` — returns `{ plan, creditsRemaining, resetDate }` for dashboard UI
- `POST /api/billing-webhook` — handles Wix plan lifecycle events

### 3.7 UI

**Dashboard header (DashboardTab.tsx)**  
Persistent plan badge + credit counter:  
`[Free Plan] · 18 / 25 AI credits used  [Upgrade to Pro]`  
Fetches from `/api/billing-status` on load.

**Sync blocked** — when Free merchant exceeds 50-product limit, sync button disables with inline message linking to Pro upgrade.

**AI enhance blocked** — when credits hit 0, Enhance button disables showing reset date. Free users also see Pro upgrade CTA.

No full-page paywall. Blocks are at the action level only.

---

## 4. Files Changed / Created

### New
- `src/backend/billingService.ts`
- `src/pages/api/billing-status.ts`
- `src/pages/api/billing-webhook.ts`
- `supabase/migrations/YYYYMMDD_credit_balance.sql`

### Modified
- `src/backend/syncService.ts` — add `checkSyncLimit` gate
- `src/backend/aiEnhancer.ts` — add `deductCredit` gate
- `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx` — credit counter + plan badge
- `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx` — sync blocked state
- `src/types/wix.types.ts` — add `planTier` to `AppConfig`
- `supabase/migrations/` — new `app_config` column `plan_tier`

### Deleted
- `src/pages/api/gmc-exchange-code.ts`
