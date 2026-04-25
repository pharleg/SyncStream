# OAuth Permanent Fix + Monetization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GMC OAuth to use a real redirect callback and enforce Free/Pro billing tiers with monthly AI credit limits.

**Architecture:** `billingService.ts` is the single enforcement layer — all billing gates flow through it. Supabase `credit_balance` table is the ledger. Wix App Management webhooks update plan tier on upgrade/downgrade. Monthly reset happens lazily on first call after reset date passes. `sync-stream.tsx` fetches billing status once on mount and passes it down as props.

**Tech Stack:** Wix `@wix/app-management` (plan tier detection), Supabase (credit ledger), vitest (unit tests), TypeScript strict mode

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `src/backend/billingService.ts` | All billing logic: lazy init, plan check, sync limit, platform access, credit deduct, monthly reset |
| `src/pages/api/billing-status.ts` | GET — returns `{ plan, creditsRemaining, resetDate }` for dashboard |
| `src/pages/api/billing-webhook.ts` | POST — handles Wix app instance change events (plan upgrade/downgrade) |
| `supabase/migrations/20260424_credit_balance.sql` | New `credit_balance` table |
| `supabase/migrations/20260424_app_config_plan_tier.sql` | Add `plan_tier` column to `app_config` |
| `src/backend/billingService.test.ts` | vitest unit tests for billingService |

### Modified files
| File | Change |
|---|---|
| `src/types/wix.types.ts` | Add `planTier?: 'free' \| 'pro'` to `AppConfig` |
| `src/backend/dataService.ts` | Read/write `plan_tier` in `getAppConfig`/`saveAppConfig` |
| `src/backend/syncService.ts` | Call `checkSyncLimit` + `checkPlatformAccess` before pushing |
| `src/backend/aiEnhancer.ts` | Call `deductCredit` before calling Claude API |
| `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | Fetch billing status on mount, pass to children |
| `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx` | Accept + render `billingStatus` prop (credit bar + plan badge) |
| `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx` | Accept `billingStatus` prop, disable sync button at limit |
| `src/extensions/dashboard/pages/connect/connect.tsx` | Hide Meta card when plan is `'free'` |

### Deleted files
| File | Reason |
|---|---|
| `src/pages/api/gmc-exchange-code.ts` | Manual OAuth flow replaced by real redirect callback |

---

## Task 1: OAuth — Verify deployed callback URL and configure permanent redirect

**Files:**
- Delete: `src/pages/api/gmc-exchange-code.ts`
- Modify: `src/pages/api/gmc-oauth-init.ts` (comment cleanup only)

- [ ] **Step 1: Build and release the app to get the deployed URL**

```bash
wix release
```

After the release completes, Wix will show the deployed app URL. Find the base URL for API routes — it will look like:
`https://www.wix.com/_api/sync-stream/` or similar.

- [ ] **Step 2: Confirm the callback URL and its stability**

Test that this URL responds: `{base-url}/api/gmc-oauth-callback`

Then check: does the URL change on each release? If it does, **stop here** and keep `gmc-exchange-code.ts` until you confirm a stable URL. Only proceed to step 3 if the URL is stable across releases.

- [ ] **Step 3: Register the callback URL in Google Cloud Console**

In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client:
- Add `{base-url}/api/gmc-oauth-callback` to Authorized redirect URIs
- Save

- [ ] **Step 4: Update the `gmc_redirect_uri` secret**

In Wix Secrets Manager (app dashboard), update the `gmc_redirect_uri` secret to `{base-url}/api/gmc-oauth-callback`.

- [ ] **Step 5: Delete the manual exchange flow**

```bash
rm src/pages/api/gmc-exchange-code.ts
```

- [ ] **Step 6: Clean up the stale comment in gmc-oauth-init.ts**

Open `src/pages/api/gmc-oauth-init.ts`. The current file starts with:

```typescript
/**
 * GET /api/gmc-oauth-init
 * Returns the GMC OAuth authorization URL.
 * Redirect URI points to editorx.io (will 404 but user copies code from URL).
 */
```

Change to:

```typescript
/**
 * GET /api/gmc-oauth-init
 * Returns the GMC OAuth authorization URL for the Google OAuth consent flow.
 * On consent, Google redirects to /api/gmc-oauth-callback with the auth code.
 */
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/gmc-oauth-init.ts
git rm src/pages/api/gmc-exchange-code.ts
git commit -m "fix: replace manual GMC OAuth code exchange with permanent redirect callback"
```

---

## Task 2: Install vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts` at the project root:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify vitest runs**

```bash
npm test
```

Expected output: `No test files found` (no tests yet — this confirms vitest is wired correctly).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for unit testing"
```

---

## Task 3: Supabase migrations

**Files:**
- Create: `supabase/migrations/20260424_credit_balance.sql`
- Create: `supabase/migrations/20260424_app_config_plan_tier.sql`

- [ ] **Step 1: Write credit_balance migration**

Create `supabase/migrations/20260424_credit_balance.sql`:

```sql
CREATE TABLE IF NOT EXISTS credit_balance (
  instance_id       TEXT        PRIMARY KEY,
  plan_tier         TEXT        NOT NULL DEFAULT 'free'
                                CHECK (plan_tier IN ('free', 'pro')),
  credits_remaining INTEGER     NOT NULL DEFAULT 25,
  reset_date        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

ALTER TABLE credit_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON credit_balance
  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Write app_config plan_tier migration**

Create `supabase/migrations/20260424_app_config_plan_tier.sql`:

```sql
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'pro'));
```

- [ ] **Step 3: Apply migrations via Supabase MCP**

Use the Supabase MCP tool to apply both migrations to the project. Confirm both run without error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424_credit_balance.sql \
        supabase/migrations/20260424_app_config_plan_tier.sql
git commit -m "feat: add credit_balance table and plan_tier column"
```

---

## Task 4: Update AppConfig type and dataService

**Files:**
- Modify: `src/types/wix.types.ts` (line ~92, the `AppConfig` interface)
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Add planTier to AppConfig**

In `src/types/wix.types.ts`, inside the `AppConfig` interface, add after `setupScreenShown`:

```typescript
  /** Billing plan tier for this instance. */
  planTier?: 'free' | 'pro';
```

- [ ] **Step 2: Read planTier in getAppConfig**

In `src/backend/dataService.ts`, inside `getAppConfig`, add to the returned object after `setupScreenShown`:

```typescript
    planTier: (data.plan_tier as 'free' | 'pro') ?? 'free',
```

- [ ] **Step 3: Write planTier in saveAppConfig**

In `src/backend/dataService.ts`, inside `saveAppConfig`, add to the upsert object after `setup_screen_shown`:

```typescript
        plan_tier: config.planTier ?? 'free',
```

- [ ] **Step 4: Commit**

```bash
git add src/types/wix.types.ts src/backend/dataService.ts
git commit -m "feat: add planTier to AppConfig type and dataService"
```

---

## Task 5: billingService.ts — tests and implementation

**Files:**
- Create: `src/backend/billingService.ts`
- Create: `src/backend/billingService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/backend/billingService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @wix/secrets before importing billingService
vi.mock('@wix/secrets', () => ({
  secrets: {
    getSecretValue: vi.fn().mockResolvedValue({ value: 'mock-value' }),
  },
}));

// Mock @supabase/supabase-js
const mockSingle = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({ error: null });
const mockInsert = vi.fn().mockReturnValue({ error: null });
const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  update: mockUpdate,
  insert: mockInsert,
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({ from: mockFrom }),
}));

import {
  getPlan,
  checkSyncLimit,
  checkPlatformAccess,
  deductCredit,
  getCreditBalance,
  BillingError,
  __resetClientForTesting,
} from './billingService';

const NOW = new Date('2026-04-24T12:00:00Z');
const FUTURE_RESET = new Date('2026-05-24T12:00:00Z').toISOString();
const PAST_RESET = new Date('2026-03-24T12:00:00Z').toISOString();

function mockRow(overrides: Partial<{
  plan_tier: string;
  credits_remaining: number;
  reset_date: string;
}> = {}) {
  return {
    instance_id: 'test-instance',
    plan_tier: 'free',
    credits_remaining: 25,
    reset_date: FUTURE_RESET,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetClientForTesting();
  // Default: row exists with Free plan and 25 credits
  mockSingle.mockResolvedValue({ data: mockRow(), error: null });
  mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  mockInsert.mockResolvedValue({ error: null });
});

describe('getPlan', () => {
  it('returns free when plan_tier is free', async () => {
    expect(await getPlan('test-instance')).toBe('free');
  });

  it('returns pro when plan_tier is pro', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ plan_tier: 'pro' }), error: null });
    expect(await getPlan('test-instance')).toBe('pro');
  });
});

describe('checkSyncLimit', () => {
  it('throws SYNC_LIMIT_REACHED when free plan has more than 50 products', async () => {
    await expect(checkSyncLimit('test-instance', 51))
      .rejects.toMatchObject({ code: 'SYNC_LIMIT_REACHED' });
  });

  it('throws SYNC_LIMIT_REACHED at exactly 51 products on free', async () => {
    await expect(checkSyncLimit('test-instance', 51))
      .rejects.toBeInstanceOf(BillingError);
  });

  it('passes at exactly 50 products on free', async () => {
    await expect(checkSyncLimit('test-instance', 50)).resolves.toBeUndefined();
  });

  it('passes for pro plan with 10000 products', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ plan_tier: 'pro' }), error: null });
    await expect(checkSyncLimit('test-instance', 10000)).resolves.toBeUndefined();
  });
});

describe('checkPlatformAccess', () => {
  it('throws PLATFORM_NOT_AVAILABLE for free plan trying meta', async () => {
    await expect(checkPlatformAccess('test-instance', 'meta'))
      .rejects.toMatchObject({ code: 'PLATFORM_NOT_AVAILABLE' });
  });

  it('passes for free plan accessing gmc', async () => {
    await expect(checkPlatformAccess('test-instance', 'gmc')).resolves.toBeUndefined();
  });

  it('passes for pro plan accessing meta', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ plan_tier: 'pro' }), error: null });
    await expect(checkPlatformAccess('test-instance', 'meta')).resolves.toBeUndefined();
  });
});

describe('deductCredit', () => {
  it('throws NO_CREDITS when credits_remaining is 0', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ credits_remaining: 0 }), error: null });
    await expect(deductCredit('test-instance'))
      .rejects.toMatchObject({ code: 'NO_CREDITS' });
  });

  it('calls update to decrement credits when credits > 0', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: updateEq });
    await deductCredit('test-instance');
    expect(mockFrom).toHaveBeenCalledWith('credit_balance');
    expect(mockUpdate).toHaveBeenCalledWith({ credits_remaining: 24 });
    expect(updateEq).toHaveBeenCalledWith('instance_id', 'test-instance');
  });
});

describe('getCreditBalance', () => {
  it('returns remaining and resetDate', async () => {
    const result = await getCreditBalance('test-instance');
    expect(result.remaining).toBe(25);
    expect(result.resetDate).toBeInstanceOf(Date);
  });
});

describe('lazy init', () => {
  it('creates a free row when no row exists', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      insert: insertMock,
    });
    await getPlan('test-instance');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ plan_tier: 'free', credits_remaining: 25 })
    );
  });
});

describe('monthly reset', () => {
  it('resets credits to tier quota when reset_date is in the past', async () => {
    mockSingle.mockResolvedValue({
      data: mockRow({ credits_remaining: 3, reset_date: PAST_RESET }),
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: updateEq });

    const result = await getCreditBalance('test-instance');

    // After reset, balance should be the Free quota (25)
    expect(result.remaining).toBe(25);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ credits_remaining: 25 })
    );
  });

  it('resets pro credits to 500 after billing period', async () => {
    mockSingle.mockResolvedValue({
      data: mockRow({ plan_tier: 'pro', credits_remaining: 10, reset_date: PAST_RESET }),
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: updateEq });

    const result = await getCreditBalance('test-instance');
    expect(result.remaining).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
npm test
```

Expected: multiple failures like `Cannot find module './billingService'`

- [ ] **Step 3: Implement billingService.ts**

Create `src/backend/billingService.ts`:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secrets } from '@wix/secrets';

export class BillingError extends Error {
  constructor(
    public code: 'SYNC_LIMIT_REACHED' | 'NO_CREDITS' | 'PLATFORM_NOT_AVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

interface CreditRow {
  instance_id: string;
  plan_tier: 'free' | 'pro';
  credits_remaining: number;
  reset_date: string;
}

const FREE_CREDITS = 25;
const PRO_CREDITS = 500;
const FREE_PRODUCT_LIMIT = 50;
const RESET_INTERVAL_DAYS = 30;

function creditQuota(tier: 'free' | 'pro'): number {
  return tier === 'pro' ? PRO_CREDITS : FREE_CREDITS;
}

// Production client (lazily created)
let _client: SupabaseClient | null = null;

// Test hook — call __resetClientForTesting() in beforeEach to clear cached client
export function __resetClientForTesting(): void {
  _client = null;
}

async function getClient(): Promise<SupabaseClient> {
  if (_client) return _client;
  const url = (await secrets.getSecretValue('supabase_project_url')).value!;
  const key = (await secrets.getSecretValue('supabase_service_role')).value!;
  _client = createClient(url, key);
  return _client;
}

/** Create a Free row if none exists for this instanceId. */
async function ensureRow(instanceId: string, db: SupabaseClient): Promise<CreditRow> {
  const { data, error } = await db
    .from('credit_balance')
    .select('*')
    .eq('instance_id', instanceId)
    .single();

  if (data) return data as CreditRow;

  // No row — lazy init with Free defaults
  const resetDate = new Date(Date.now() + RESET_INTERVAL_DAYS * 86_400_000).toISOString();
  const row: CreditRow = {
    instance_id: instanceId,
    plan_tier: 'free',
    credits_remaining: FREE_CREDITS,
    reset_date: resetDate,
  };
  await db.from('credit_balance').insert(row);
  return row;
}

/**
 * Get the row for this instance, running a monthly reset first if overdue.
 * This is the single entry point used by all exported functions.
 */
async function getRow(instanceId: string, db: SupabaseClient): Promise<CreditRow> {
  let row = await ensureRow(instanceId, db);

  if (new Date() > new Date(row.reset_date)) {
    const newCredits = creditQuota(row.plan_tier);
    const newResetDate = new Date(Date.now() + RESET_INTERVAL_DAYS * 86_400_000).toISOString();
    await db
      .from('credit_balance')
      .update({ credits_remaining: newCredits, reset_date: newResetDate })
      .eq('instance_id', instanceId);
    row = { ...row, credits_remaining: newCredits, reset_date: newResetDate };
  }

  return row;
}

export async function getPlan(instanceId: string): Promise<'free' | 'pro'> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  return row.plan_tier;
}

export async function checkSyncLimit(
  instanceId: string,
  productCount: number,
): Promise<void> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  if (row.plan_tier === 'free' && productCount > FREE_PRODUCT_LIMIT) {
    throw new BillingError(
      'SYNC_LIMIT_REACHED',
      `Free plan is limited to ${FREE_PRODUCT_LIMIT} products. Upgrade to Pro for unlimited sync.`,
    );
  }
}

export async function checkPlatformAccess(
  instanceId: string,
  platform: 'gmc' | 'meta',
): Promise<void> {
  if (platform !== 'meta') return;
  const db = await getClient();
  const row = await getRow(instanceId, db);
  if (row.plan_tier === 'free') {
    throw new BillingError(
      'PLATFORM_NOT_AVAILABLE',
      'Meta sync requires a Pro plan.',
    );
  }
}

export async function deductCredit(instanceId: string): Promise<void> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  if (row.credits_remaining <= 0) {
    const resetOn = new Date(row.reset_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
    throw new BillingError(
      'NO_CREDITS',
      `No AI credits remaining. Resets on ${resetOn}.`,
    );
  }
  await db
    .from('credit_balance')
    .update({ credits_remaining: row.credits_remaining - 1 })
    .eq('instance_id', instanceId);
}

export async function getCreditBalance(
  instanceId: string,
): Promise<{ remaining: number; resetDate: Date }> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  return { remaining: row.credits_remaining, resetDate: new Date(row.reset_date) };
}

/**
 * Set plan tier directly — called from billing webhook on plan upgrade/downgrade.
 * Preserves current credits_remaining and reset_date.
 */
export async function setPlanTier(
  instanceId: string,
  tier: 'free' | 'pro',
): Promise<void> {
  const db = await getClient();
  await ensureRow(instanceId, db);
  await db
    .from('credit_balance')
    .update({ plan_tier: tier })
    .eq('instance_id', instanceId);
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
npm test
```

Expected output: all tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/backend/billingService.ts src/backend/billingService.test.ts
git commit -m "feat: implement billingService with Free/Pro enforcement and monthly AI credit reset"
```

---

## Task 6: GET /api/billing-status

**Files:**
- Create: `src/pages/api/billing-status.ts`

- [ ] **Step 1: Implement the endpoint**

Create `src/pages/api/billing-status.ts`:

```typescript
import type { APIRoute } from 'astro';
import { getCreditBalance, getPlan } from '../../backend/billingService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? 'default';

    const [plan, balance] = await Promise.all([
      getPlan(instanceId),
      getCreditBalance(instanceId),
    ]);

    return new Response(
      JSON.stringify({
        plan,
        creditsRemaining: balance.remaining,
        resetDate: balance.resetDate.toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Manual test**

With `wix dev` running, call:
```
GET /api/billing-status?instanceId=default
```
Expected response:
```json
{ "plan": "free", "creditsRemaining": 25, "resetDate": "2026-05-24T..." }
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/billing-status.ts
git commit -m "feat: add GET /api/billing-status endpoint"
```

---

## Task 7: POST /api/billing-webhook

**Files:**
- Create: `src/pages/api/billing-webhook.ts`

**Note:** Wix sends app instance change events via webhook when a merchant upgrades or downgrades. The exact payload format should be verified in the Wix App Management docs. The implementation below handles the most common Wix webhook envelope — verify `eventType` strings match what Wix actually sends before deploying.

- [ ] **Step 1: Implement the webhook handler**

Create `src/pages/api/billing-webhook.ts`:

```typescript
import type { APIRoute } from 'astro';
import { setPlanTier } from '../../backend/billingService';
import { getAppConfig, saveAppConfig } from '../../backend/dataService';

/**
 * Wix sends app instance events when a merchant upgrades or cancels.
 * Event body follows the Wix webhook envelope format.
 *
 * Verify the exact eventType strings in:
 * https://dev.wix.com/docs/rest/api-reference/app-management/apps/app-instance/introduction
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as {
      eventType?: string;
      instanceId?: string;
      data?: {
        instance?: {
          instanceId?: string;
          billing?: {
            packageName?: string;
            packageId?: string;
          };
        };
      };
    };

    const instanceId = body.instanceId ?? body.data?.instance?.instanceId;
    if (!instanceId) {
      return new Response(JSON.stringify({ error: 'Missing instanceId' }), { status: 400 });
    }

    const eventType = body.eventType ?? '';
    const packageName = body.data?.instance?.billing?.packageName?.toLowerCase() ?? '';

    // Map Wix package name to our tier — 'pro' if package name contains 'pro', else 'free'
    const tier: 'free' | 'pro' = packageName.includes('pro') ? 'pro' : 'free';

    if (
      eventType.includes('upgraded') ||
      eventType.includes('activated') ||
      eventType.includes('changed') ||
      eventType.includes('INSTANCE_CHANGED')
    ) {
      await setPlanTier(instanceId, tier);

      // Keep AppConfig in sync
      const config = await getAppConfig(instanceId);
      if (config) {
        config.planTier = tier;
        await saveAppConfig(config);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Register the webhook in Wix Dev Center**

In Wix Dev Center → your app → Webhooks, register:
- URL: `{deployed-base-url}/api/billing-webhook`
- Event: App Instance Changed (or equivalent — check Wix docs for exact event name)

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/billing-webhook.ts
git commit -m "feat: add billing webhook handler for plan upgrade/downgrade events"
```

---

## Task 8: Gate syncService — product limit + platform access

**Files:**
- Modify: `src/backend/syncService.ts`

- [ ] **Step 1: Read syncService.ts to find the sync entry point**

Open `src/backend/syncService.ts`. Find the function that accepts a list of products and pushes to GMC/Meta. It will be something like `syncProducts` or `runFullSync`. Note the function signature and where it begins iterating products.

- [ ] **Step 2: Add import**

At the top of `syncService.ts`, add:

```typescript
import { checkSyncLimit, checkPlatformAccess, BillingError } from './billingService';
```

- [ ] **Step 3: Add checkSyncLimit gate**

At the start of the sync function, before any product processing, add (substitute the real `instanceId` and `productCount` variable names you find in step 1):

```typescript
await checkSyncLimit(instanceId, products.length);
```

If `checkSyncLimit` throws a `BillingError` with code `'SYNC_LIMIT_REACHED'`, it will propagate to the API layer which returns a 402.

- [ ] **Step 4: Add checkPlatformAccess gate**

Where the code pushes to a specific platform (look for the GMC or Meta push call), add before each platform push:

```typescript
await checkPlatformAccess(instanceId, 'gmc');  // or 'meta'
```

- [ ] **Step 5: Make the API layer return 402 on BillingError**

In `src/pages/api/products-sync.ts`, wrap the sync call and add 402 handling:

```typescript
import { BillingError } from '../../backend/billingService';

// Inside the handler, after calling sync:
} catch (error) {
  if (error instanceof BillingError) {
    return new Response(JSON.stringify({ error: error.message, code: error.code }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // existing error handling...
}
```

- [ ] **Step 6: Commit**

```bash
git add src/backend/syncService.ts src/pages/api/products-sync.ts
git commit -m "feat: enforce sync product limit and platform access gates in syncService"
```

---

## Task 9: Gate aiEnhancer — credit deduction

**Files:**
- Modify: `src/backend/aiEnhancer.ts`

- [ ] **Step 1: Add import**

At the top of `src/backend/aiEnhancer.ts`, add:

```typescript
import { deductCredit, BillingError } from './billingService';
```

- [ ] **Step 2: Add deductCredit call in generateEnhancement**

In `generateEnhancement` (line ~77 of `aiEnhancer.ts`), before the `client.messages.create` call, add:

```typescript
await deductCredit(instanceId);
```

The function signature needs `instanceId` — update the signature from:

```typescript
async function generateEnhancement(
  product: WixProduct,
  style?: string,
): Promise<{ title: string; description: string }>
```

to:

```typescript
async function generateEnhancement(
  product: WixProduct,
  instanceId: string,
  style?: string,
): Promise<{ title: string; description: string }>
```

- [ ] **Step 3: Thread instanceId through callers**

`generateEnhancement` is called from `enhanceProduct` and `enhanceProducts`. Both already receive `instanceId` as a parameter. Update the calls to pass `instanceId`:

In `enhanceProduct` (line ~129):
```typescript
const enhanced = await generateEnhancement(product, instanceId, style);
```

In `enhanceProducts` (line ~166):
```typescript
const enhanced = await generateEnhancement(product, instanceId, style);
```

- [ ] **Step 4: Return 402 on BillingError in the enhance API endpoints**

In `src/pages/api/products-enhance.ts`, add BillingError handling to the catch block:

```typescript
import { BillingError } from '../../backend/billingService';

// In the catch block:
} catch (error) {
  if (error instanceof BillingError) {
    return new Response(JSON.stringify({ error: error.message, code: error.code }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // existing error handling...
}
```

Repeat the same 402 handling in `src/pages/api/enhance.ts` and `src/pages/api/wizard-generate.ts` if they call AI enhancement.

- [ ] **Step 5: Commit**

```bash
git add src/backend/aiEnhancer.ts src/pages/api/products-enhance.ts \
        src/pages/api/enhance.ts src/pages/api/wizard-generate.ts
git commit -m "feat: deduct AI credit before each enhancement, return 402 on NO_CREDITS"
```

---

## Task 10: UI — sync-stream.tsx fetches billing status

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

This is the root component. It already fetches app config on mount. Add billing status to the same load sequence and pass it down as a prop.

- [ ] **Step 1: Add BillingStatus type and state**

At the top of `sync-stream.tsx`, near the existing type definitions, add:

```typescript
interface BillingStatus {
  plan: 'free' | 'pro';
  creditsRemaining: number;
  resetDate: string;
}
```

Inside the component, add state:

```typescript
const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
```

- [ ] **Step 2: Fetch billing status on mount**

Find where the component fetches `app-config` on mount (look for a `useEffect` that calls `appFetch('/api/app-config...')`). Add a parallel fetch for billing status:

```typescript
const [configRes, billingRes] = await Promise.all([
  appFetch(`/api/app-config?instanceId=${instanceId}`),
  appFetch(`/api/billing-status?instanceId=${instanceId}`),
]);

if (billingRes.ok) {
  const billing = await billingRes.json() as BillingStatus;
  setBillingStatus(billing);
}
```

- [ ] **Step 3: Pass billingStatus to DashboardTabNormal**

Find where `DashboardTabNormal` is rendered and add the prop:

```typescript
<DashboardTabNormal
  // ...existing props...
  billingStatus={billingStatus}
/>
```

- [ ] **Step 4: Pass billingStatus to ProductsTabComponent**

Find where `ProductsTabComponent` is rendered and add:

```typescript
<ProductsTabComponent
  // ...existing props...
  billingStatus={billingStatus}
/>
```

- [ ] **Step 5: Pass billingStatus to ConnectPage (if rendered inline)**

If `connect.tsx` is a separate page route (not rendered inside sync-stream.tsx), skip this step. The connect page fetches its own data.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: fetch billing status on mount and pass to child components"
```

---

## Task 11: UI — DashboardTab credit counter and plan badge

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx`

- [ ] **Step 1: Add billingStatus prop to DashboardTabNormalProps**

In `DashboardTab.tsx`, update the `DashboardTabNormalProps` interface:

```typescript
interface BillingStatus {
  plan: 'free' | 'pro';
  creditsRemaining: number;
  resetDate: string;
}

interface DashboardTabNormalProps {
  // ...existing fields...
  billingStatus: BillingStatus | null;
}
```

- [ ] **Step 2: Add billingStatus to the destructured props**

In `DashboardTabNormal`, add `billingStatus` to the destructured parameter:

```typescript
export const DashboardTabNormal: FC<DashboardTabNormalProps> = ({
  stats,
  platformHealth,
  topIssues,
  recentEvents,
  syncing,
  onSyncNow,
  onCheckCompliance,
  onNavigateToFailed,
  billingStatus,
}) => {
```

- [ ] **Step 3: Add the billing bar above the stat cards**

In the returned JSX, insert before the `{/* Stat cards */}` block:

```typescript
{billingStatus && (
  <Box
    verticalAlign="middle"
    gap="12px"
    style={{
      padding: '8px 14px',
      background: billingStatus.plan === 'pro' ? '#eaf4ff' : '#f7f9fb',
      border: '1px solid #e8edf0',
      borderRadius: 8,
    }}
  >
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 100,
        background: billingStatus.plan === 'pro' ? '#116dff' : '#32536a',
        color: 'white',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {billingStatus.plan === 'pro' ? 'Pro' : 'Free'}
    </span>
    <Text size="small" secondary style={{ flex: 1 }}>
      AI credits: {billingStatus.creditsRemaining} remaining · resets{' '}
      {new Date(billingStatus.resetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
    </Text>
    {billingStatus.plan === 'free' && (
      <Button
        size="tiny"
        skin="light"
        style={{ fontSize: 11 }}
        onClick={() => window.open('https://manage.wix.com/app-market', '_blank')}
      >
        Upgrade to Pro
      </Button>
    )}
  </Box>
)}
```

- [ ] **Step 4: Manual test**

With `wix dev`, open the dashboard. Confirm the billing bar appears above the stat cards showing "Free · 25 AI credits remaining".

- [ ] **Step 5: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx
git commit -m "feat: add plan badge and AI credit counter to dashboard header"
```

---

## Task 12: UI — ProductsTab sync blocked state

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx`

- [ ] **Step 1: Add billingStatus prop**

Add to the `ProductsTabProps` interface:

```typescript
interface BillingStatus {
  plan: 'free' | 'pro';
  creditsRemaining: number;
  resetDate: string;
}

interface ProductsTabProps {
  // ...existing fields...
  billingStatus: BillingStatus | null;
}
```

Add `billingStatus` to the destructured props in `ProductsTab`.

- [ ] **Step 2: Compute sync blocked state**

Inside the component, add:

```typescript
const syncBlocked =
  billingStatus?.plan === 'free' &&
  products.length > 50;
```

- [ ] **Step 3: Add blocked banner above the toolbar**

In the returned JSX, insert before `{/* Toolbar */}`:

```typescript
{syncBlocked && (
  <Box
    verticalAlign="middle"
    gap="12px"
    style={{
      padding: '10px 14px',
      background: '#fff8e1',
      border: '1px solid #f5d67a',
      borderRadius: 8,
    }}
  >
    <Text size="small" style={{ flex: 1 }}>
      Free plan is limited to 50 products. You have {products.length} products — sync is paused.
    </Text>
    <Button
      size="small"
      style={{ background: '#f5a623', color: 'white', border: 'none' }}
      onClick={() => window.open('https://manage.wix.com/app-market', '_blank')}
    >
      Upgrade to Pro
    </Button>
  </Box>
)}
```

- [ ] **Step 4: Disable Sync Now button when blocked**

Find the `Sync Now` button render in `ProductsTab.tsx` (line ~139):

```typescript
<Button size="small" onClick={handleSyncNow} disabled={syncing}>
```

Change to:

```typescript
<Button size="small" onClick={handleSyncNow} disabled={syncing || syncBlocked}>
```

- [ ] **Step 5: Manual test**

With `wix dev`, confirm the sync button is not blocked for a catalog under 50 products. Temporarily change `products.length > 50` to `products.length > 0` to verify the banner and disabled button appear, then revert.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
git commit -m "feat: show sync blocked banner and disable sync button at Free plan product limit"
```

---

## Task 13: UI — connect.tsx hide Meta on Free plan

**Files:**
- Modify: `src/extensions/dashboard/pages/connect/connect.tsx`

- [ ] **Step 1: Add billing status fetch**

In `connect.tsx`, add a new API helper after the existing `callGetAppConfig`:

```typescript
async function callGetBillingStatus(): Promise<{ plan: 'free' | 'pro' } | null> {
  const response = await fetch('/api/billing-status?instanceId=default');
  if (!response.ok) return null;
  return response.json();
}
```

- [ ] **Step 2: Add plan state**

Inside `ConnectPage`, add:

```typescript
const [plan, setPlan] = useState<'free' | 'pro'>('free');
```

- [ ] **Step 3: Fetch billing status on mount**

In the existing `useEffect` (or add alongside the `callGetAppConfig` call):

```typescript
useEffect(() => {
  Promise.all([callGetAppConfig(), callGetBillingStatus()])
    .then(([config, billing]) => {
      if (config) {
        setGmcConnected(config.gmcConnected);
      }
      if (billing) {
        setPlan(billing.plan);
      }
    })
    .catch(() => {})
    .finally(() => setLoading(false));
}, []);
```

- [ ] **Step 4: Conditionally render the Meta card**

Find the Meta card in the JSX (currently shows "Coming soon — Phase 4"):

```typescript
<Card>
  <Card.Header
    title="Meta Product Catalog"
    subtitle="Coming soon — Phase 4"
    suffix={
      <Button size="small" disabled>
        Connect
      </Button>
    }
  />
</Card>
```

Replace with:

```typescript
{plan === 'pro' ? (
  <Card>
    <Card.Header
      title="Meta Product Catalog"
      subtitle={
        metaConnected
          ? 'Connected'
          : 'Connect to sync products to Meta Shopping'
      }
      suffix={
        metaConnected ? (
          <Text size="small" skin="success" weight="bold">
            Connected
          </Text>
        ) : (
          <Button size="small" disabled>
            Connect {/* Phase 4: wire OAuth */}
          </Button>
        )
      }
    />
  </Card>
) : (
  <Card>
    <Card.Header
      title="Meta Product Catalog"
      subtitle="Available on Pro plan"
      suffix={
        <Button
          size="small"
          skin="light"
          onClick={() => window.open('https://manage.wix.com/app-market', '_blank')}
        >
          Upgrade to Pro
        </Button>
      }
    />
  </Card>
)}
```

Also add `metaConnected` state (it's already in app config response but may not be in state — add `const [metaConnected, setMetaConnected] = useState(false)` and set it from `callGetAppConfig` response).

- [ ] **Step 5: Manual test**

With `wix dev`, open the Connect page. Confirm Meta card shows "Available on Pro plan" with an Upgrade button, not a disabled Connect button.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/connect/connect.tsx
git commit -m "feat: hide Meta connect behind Pro plan gate on Connect page"
```

---

## Self-Review Notes

- **Spec coverage:** OAuth fix ✓, plan tiers ✓, lazy init (ensureRow in every function) ✓, monthly reset ✓, sync limit gate ✓, platform access gate ✓, AI credit gate ✓, billing webhook ✓, billing status endpoint ✓, dashboard credit bar ✓, sync blocked UI ✓, Meta hidden on Free ✓, plan.cancelled intent (handled via webhook tier update) ✓
- **Type consistency:** `BillingStatus` interface is duplicated in `sync-stream.tsx`, `DashboardTab.tsx`, and `ProductsTab.tsx` — that is intentional (no shared type file), but the implementor can extract it to a shared type if preferred
- **Webhook format:** flagged inline in Task 7 — verify exact Wix event type strings before deploying
- **Upgrade URL:** `https://manage.wix.com/app-market` is a placeholder — replace with the actual deep-link to SyncStream's App Market upgrade page once the listing is live
