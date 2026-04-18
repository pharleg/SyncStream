# Dashboard & Products Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current minimal dashboard and fragmented Products sub-tabs with a unified design that makes sync failures, feed health, and compliance issues undeniable and immediately actionable.

**Architecture:** The existing `DashboardTab` and `ProductsTab` components inside the 2,800-line `sync-stream.tsx` monolith are extracted into dedicated files (`DashboardTab.tsx`, `ProductsTab.tsx`, `ProductRow.tsx`). A new `sync_events` Supabase table stores sync run history for the activity feed. The `/api/sync-status` endpoint is extended to return per-platform health data, warning counts, and top issues aggregated by type. All data flows down as props — no internal data fetching in leaf components.

**Tech Stack:** React + TypeScript, @wix/design-system, Supabase (Postgres), Astro API routes, Wix CLI

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `supabase/migrations/20260418_sync_events.sql` | sync_events table + index |
| Modify | `src/backend/dataService.ts` | Add SyncEvent type + 3 new functions |
| Modify | `src/backend/syncService.ts` | Write sync event at end of each run |
| Modify | `src/pages/api/sync-status.ts` | Add warnings, per-platform health, topIssues |
| Create | `src/pages/api/sync-events.ts` | GET recent activity events |
| Create | `src/extensions/dashboard/pages/sync-stream/ProductRow.tsx` | Single product row + expanded panel |
| Create | `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx` | Unified product table (no sub-tabs) |
| Create | `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx` | Stats + health + actions + activity + issues |
| Modify | `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | Wire up new components, remove old ones |

---

## Task 1: sync_events Supabase Migration

**Files:**
- Create: `supabase/migrations/20260418_sync_events.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260418_sync_events.sql

CREATE TABLE IF NOT EXISTS sync_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  text NOT NULL,
  event_type   text NOT NULL,  -- 'sync_complete' | 'sync_error' | 'compliance_check' | 'manual_fix'
  message      text NOT NULL,
  severity     text NOT NULL,  -- 'success' | 'error' | 'info' | 'warning'
  product_count int,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_events_instance_created
  ON sync_events (instance_id, created_at DESC);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with the SQL above, or run:
```bash
# Confirm the migration file exists
cat supabase/migrations/20260418_sync_events.sql
```

- [ ] **Step 3: Verify the table was created**

Run via Supabase MCP `execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sync_events'
ORDER BY ordinal_position;
```
Expected: 7 rows — id, instance_id, event_type, message, severity, product_count, created_at.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260418_sync_events.sql
git commit -m "feat: add sync_events table for activity feed"
```

---

## Task 2: dataService — SyncEvent Type and CRUD Functions

**Files:**
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Add the SyncEvent interface and three new exported functions**

Add this block at the end of `src/backend/dataService.ts` (after the last existing export):

```typescript
// ---------------------------------------------------------------------------
// Sync Events (recent activity feed)
// ---------------------------------------------------------------------------

export interface SyncEvent {
  id?: string;
  instanceId: string;
  eventType: 'sync_complete' | 'sync_error' | 'compliance_check' | 'manual_fix';
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
  productCount?: number;
  createdAt?: string;
}

export async function upsertSyncEvent(event: Omit<SyncEvent, 'id' | 'createdAt'>): Promise<void> {
  const db = await getClient();
  const { error } = await db.from('sync_events').insert({
    instance_id: event.instanceId,
    event_type: event.eventType,
    message: event.message,
    severity: event.severity,
    product_count: event.productCount ?? null,
  });
  if (error) throw new Error(`Failed to insert sync event: ${error.message}`);
}

export async function getRecentEvents(instanceId: string, limit = 10): Promise<SyncEvent[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_events')
    .select('*')
    .eq('instance_id', instanceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch sync events: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    eventType: row.event_type,
    message: row.message,
    severity: row.severity,
    productCount: row.product_count ?? undefined,
    createdAt: row.created_at,
  }));
}

export interface TopIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  count: number;
}

export async function getTopIssues(
  instanceId: string,
  platform: 'gmc' | 'meta',
  limit = 6,
): Promise<TopIssue[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_state')
    .select('error_log')
    .eq('instance_id', instanceId)
    .eq('platform', platform);
  if (error) throw new Error(`Failed to fetch sync states for top issues: ${error.message}`);

  const counts = new Map<string, { message: string; severity: 'error' | 'warning'; count: number }>();
  for (const row of data ?? []) {
    const log = Array.isArray(row.error_log) ? row.error_log : [];
    for (const entry of log) {
      if (!entry.field || !entry.message) continue;
      const key = `${entry.field}||${entry.message}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, {
          message: entry.message,
          severity: entry.severity === 'warning' ? 'warning' : 'error',
          count: 1,
        });
      }
    }
  }

  return Array.from(counts.entries())
    .map(([key, val]) => ({ field: key.split('||')[0], ...val }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, limit);
}
```

Note: `getTopIssues` queries `sync_state` without `instance_id` filter because the existing `sync_state` table does not have an `instance_id` column. The query above fetches all rows for the platform and filters in JS. If `instance_id` is added later, update accordingly.

**Correction**: Looking at the existing `querySyncStates` function — it does NOT filter by instance_id either (no such column). Keep the `getTopIssues` query without `instance_id` filter:

```typescript
export async function getTopIssues(
  _instanceId: string,
  platform: 'gmc' | 'meta',
  limit = 6,
): Promise<TopIssue[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_state')
    .select('error_log')
    .eq('platform', platform);
  if (error) throw new Error(`Failed to fetch sync states for top issues: ${error.message}`);

  const counts = new Map<string, { message: string; severity: 'error' | 'warning'; count: number }>();
  for (const row of data ?? []) {
    const log = Array.isArray(row.error_log) ? row.error_log : [];
    for (const entry of log) {
      if (!entry.field || !entry.message) continue;
      const key = `${entry.field}||${entry.message}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, {
          message: entry.message,
          severity: entry.severity === 'warning' ? 'warning' : 'error',
          count: 1,
        });
      }
    }
  }

  return Array.from(counts.entries())
    .map(([key, val]) => ({ field: key.split('||')[0], ...val }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, limit);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/curtismcewen/Documents/Git/SyncStream/sync-stream
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/backend/dataService.ts
git commit -m "feat: add SyncEvent type, upsertSyncEvent, getRecentEvents, getTopIssues"
```

---

## Task 3: syncService — Write Sync Event at End of Each Run

**Files:**
- Modify: `src/backend/syncService.ts`

- [ ] **Step 1: Add upsertSyncEvent to the import from dataService**

In `src/backend/syncService.ts`, find the existing import block from `./dataService`:

```typescript
import {
  bulkUpsertSyncStates,
  getCachedProducts,
  getCachedProductsByIds,
  upsertSyncProgress,
  getSyncContext,
} from './dataService';
```

Replace with:

```typescript
import {
  bulkUpsertSyncStates,
  getCachedProducts,
  getCachedProductsByIds,
  upsertSyncProgress,
  getSyncContext,
  upsertSyncEvent,
} from './dataService';
```

- [ ] **Step 2: Write a sync event at the end of runPaginatedSync — success case**

In `runPaginatedSync`, find the block after `await tryProgress(progress)` in the try branch (around line 510):

```typescript
    progress.currentStatus = 'completed';
    progress.processed = totalProducts;
    progress.syncedCount = allResults.filter((r) => r.success).length;
    progress.failedCount = allResults.filter((r) => !r.success).length;
    progress.updatedAt = new Date().toISOString();
    await tryProgress(progress);
```

Replace with:

```typescript
    progress.currentStatus = 'completed';
    progress.processed = totalProducts;
    progress.syncedCount = allResults.filter((r) => r.success).length;
    progress.failedCount = allResults.filter((r) => !r.success).length;
    progress.updatedAt = new Date().toISOString();
    await tryProgress(progress);

    // Write activity event (best-effort — don't fail the sync if this fails)
    const failedCount = progress.failedCount;
    const syncedCount = progress.syncedCount;
    await upsertSyncEvent({
      instanceId,
      eventType: failedCount > 0 ? 'sync_error' : 'sync_complete',
      message: failedCount > 0
        ? `${syncedCount} synced, ${failedCount} failed out of ${totalProducts} products`
        : `${syncedCount} products synced successfully`,
      severity: failedCount > 0 ? 'error' : 'success',
      productCount: totalProducts,
    }).catch(() => {});
```

- [ ] **Step 3: Write a sync event in the catch branch**

Find the catch block in `runPaginatedSync`:

```typescript
  } catch (error) {
    progress.currentStatus = 'error';
    progress.error = error instanceof Error ? error.message : 'Unknown error';
    await tryProgress(progress);
    throw error;
  }
```

Replace with:

```typescript
  } catch (error) {
    progress.currentStatus = 'error';
    progress.error = error instanceof Error ? error.message : 'Unknown error';
    await tryProgress(progress);
    await upsertSyncEvent({
      instanceId,
      eventType: 'sync_error',
      message: progress.error,
      severity: 'error',
    }).catch(() => {});
    throw error;
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/backend/syncService.ts
git commit -m "feat: write sync_events on sync run completion"
```

---

## Task 4: Update /api/sync-status to Include Warnings, Per-Platform Health, and Top Issues

**Files:**
- Modify: `src/pages/api/sync-status.ts`

- [ ] **Step 1: Update the imports and rewrite the endpoint**

Replace the entire contents of `src/pages/api/sync-status.ts` with:

```typescript
/**
 * GET /api/sync-status
 * Returns sync state summary, per-platform health, records, top issues, and grouped issue types.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, querySyncStates, getTopIssues } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';

    const [config, states] = await Promise.all([
      getAppConfig(instanceId),
      querySyncStates(500),
    ]);

    const records = states.map((s) => ({
      productId: s.productId,
      platform: s.platform,
      status: s.status,
      lastSynced: s.lastSynced.toISOString(),
      errorCount: Array.isArray(s.errorLog) ? s.errorLog.length : 0,
      errorMessages: Array.isArray(s.errorLog)
        ? s.errorLog.map((e: any) => e.message as string)
        : [],
      errorLog: Array.isArray(s.errorLog) ? s.errorLog : [],
    }));

    // Counts across all platforms (deduplicate by productId for totals)
    const productStatuses = new Map<string, 'synced' | 'error' | 'warning' | 'pending'>();
    for (const s of states) {
      const current = productStatuses.get(s.productId);
      // error > warning > synced > pending
      if (!current || current === 'pending' || (current === 'synced' && s.status !== 'pending') || (current === 'warning' && s.status === 'error')) {
        const log = Array.isArray(s.errorLog) ? s.errorLog : [];
        const hasErrors = log.some((e: any) => e.severity === 'error' || !e.severity) && s.status === 'error';
        const hasWarnings = log.some((e: any) => e.severity === 'warning') && s.status !== 'error';
        if (hasErrors) {
          productStatuses.set(s.productId, 'error');
        } else if (hasWarnings) {
          productStatuses.set(s.productId, 'warning');
        } else {
          productStatuses.set(s.productId, s.status as any);
        }
      }
    }

    const totalSynced = states.filter((s) => s.status === 'synced').length;
    const totalErrors = states.filter((s) => s.status === 'error').length;
    const totalPending = states.filter((s) => s.status === 'pending').length;

    // Warnings: products with warning-severity entries but not in error status
    const totalWarnings = Array.from(productStatuses.values()).filter((v) => v === 'warning').length;

    // Per-platform health
    const gmcStates = states.filter((s) => s.platform === 'gmc');
    const metaStates = states.filter((s) => s.platform === 'meta');
    const gmcSynced = gmcStates.filter((s) => s.status === 'synced').length;
    const gmcErrors = gmcStates.filter((s) => s.status === 'error').length;
    const metaSynced = metaStates.filter((s) => s.status === 'synced').length;
    const metaErrors = metaStates.filter((s) => s.status === 'error').length;
    const gmcTotal = gmcStates.length;
    const metaTotal = metaStates.length;

    // Group blocking validation errors by field for the FixWizard issueGroups
    const fieldCounts = new Map<string, { count: number; message: string }>();
    for (const s of states) {
      if (s.status === 'error' && Array.isArray(s.errorLog)) {
        for (const err of s.errorLog) {
          if (err.severity === 'error' && err.field !== 'api') {
            const existing = fieldCounts.get(err.field);
            if (existing) {
              existing.count++;
            } else {
              fieldCounts.set(err.field, { count: 1, message: err.message });
            }
          }
        }
      }
    }
    const issueGroups = Array.from(fieldCounts.entries())
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([field, { count, message }]) => ({ field, count, message }));

    // Top issues for dashboard panel (errors + warnings by type)
    const [gmcTopIssues, metaTopIssues] = await Promise.all([
      getTopIssues(instanceId, 'gmc', 6),
      getTopIssues(instanceId, 'meta', 6),
    ]);

    return new Response(
      JSON.stringify({
        totalSynced,
        totalErrors,
        totalPending,
        totalWarnings,
        lastFullSync: config?.lastFullSync?.toISOString() ?? null,
        records,
        issueGroups,
        platformHealth: {
          gmc: {
            connected: config?.gmcConnected ?? false,
            total: gmcTotal,
            synced: gmcSynced,
            errors: gmcErrors,
            pct: gmcTotal > 0 ? Math.round((gmcSynced / gmcTotal) * 100) : 0,
          },
          meta: {
            connected: config?.metaConnected ?? false,
            total: metaTotal,
            synced: metaSynced,
            errors: metaErrors,
            pct: metaTotal > 0 ? Math.round((metaSynced / metaTotal) * 100) : 0,
          },
        },
        topIssues: {
          gmc: gmcTopIssues,
          meta: metaTopIssues,
        },
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/sync-status.ts
git commit -m "feat: extend sync-status API with warnings, per-platform health, top issues"
```

---

## Task 5: New /api/sync-events Endpoint

**Files:**
- Create: `src/pages/api/sync-events.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/pages/api/sync-events.ts
import type { APIRoute } from 'astro';
import { getRecentEvents } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';
    const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);

    const events = await getRecentEvents(instanceId, limit);
    return new Response(JSON.stringify({ events }), {
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/sync-events.ts
git commit -m "feat: add /api/sync-events endpoint for activity feed"
```

---

## Task 6: ProductRow Component

**Files:**
- Create: `src/extensions/dashboard/pages/sync-stream/ProductRow.tsx`

This is the single product table row plus the expanded fix panel. It receives all data as props and calls parent handlers — no internal API calls.

- [ ] **Step 1: Define the types and create the file**

```tsx
// src/extensions/dashboard/pages/sync-stream/ProductRow.tsx
import { type FC, useState } from 'react';
import { Box, Text, Button, Input, FormField, ToggleSwitch, Loader } from '@wix/design-system';

export interface ProductIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ProductRowData {
  productId: string;
  name: string;
  imageUrl?: string;
  sku?: string;
  variantCount: number;
  price?: string;
  availability?: string;
  brand?: string;
  description?: string;
  gmcStatus: 'synced' | 'error' | 'warning' | 'pending' | null;
  metaStatus: 'synced' | 'error' | 'warning' | 'pending' | null;
  gmcIssues: ProductIssue[];
  metaIssues: ProductIssue[];
  aiEnabled: boolean;
  enhancedTitle?: string | null;
  enhancedDescription?: string | null;
  lastEnhancedAt?: string | null;
}

export interface ApplyFixPayload {
  productId: string;
  fixes: Record<string, string>;
  target: 'wix' | 'gmc' | 'both';
}

interface ProductRowProps {
  product: ProductRowData;
  isExpanded: boolean;
  onExpand: (productId: string | null) => void;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
}
```

- [ ] **Step 2: Implement the status chip helper and row background color logic**

Add after the interface definitions (still in the same file):

```tsx
const FIXABLE_FIELDS = ['brand', 'description', 'title', 'condition', 'link', 'imageLink', 'offerId'];

function statusColor(status: ProductRowData['gmcStatus']): string {
  switch (status) {
    case 'synced': return '#2e7d32';
    case 'error': return '#c62828';
    case 'warning': return '#c17d00';
    default: return '#7a92a5';
  }
}

function statusLabel(status: ProductRowData['gmcStatus']): string {
  switch (status) {
    case 'synced': return '✓ Synced';
    case 'error': return '✕ Failed';
    case 'warning': return '⚠ Warning';
    case 'pending': return '○ Pending';
    default: return '— N/A';
  }
}

function rowBackground(product: ProductRowData): string {
  if (product.gmcStatus === 'error' || product.metaStatus === 'error') return '#fffbfb';
  if (product.gmcStatus === 'warning' || product.metaStatus === 'warning') return '#fffdf5';
  return 'transparent';
}
```

- [ ] **Step 3: Implement the expanded fix panel sub-component**

```tsx
const ExpandedPanel: FC<{
  product: ProductRowData;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
}> = ({ product, onApplyFix, onToggleAI, onEnhanceNow }) => {
  const allIssues = [...product.gmcIssues, ...product.metaIssues];
  const fixableIssues = allIssues.filter((i) => FIXABLE_FIELDS.includes(i.field));
  const uniqueFixableFields = [...new Set(fixableIssues.map((i) => i.field))];

  const initialValues: Record<string, string> = {};
  for (const field of uniqueFixableFields) {
    if (field === 'brand') initialValues[field] = product.brand ?? '';
    else if (field === 'description') initialValues[field] = product.description ?? '';
    else if (field === 'title') initialValues[field] = product.name ?? '';
    else initialValues[field] = '';
  }

  const [fixValues, setFixValues] = useState<Record<string, string>>(initialValues);
  const [applying, setApplying] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const handleApply = async (target: 'wix' | 'gmc' | 'both') => {
    setApplying(true);
    try {
      await onApplyFix({ productId: product.productId, fixes: fixValues, target });
    } finally {
      setApplying(false);
    }
  };

  const handleEnhance = async () => {
    setEnhancing(true);
    try {
      await onEnhanceNow(product.productId);
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <Box
      style={{ background: '#f7f9fb', borderTop: '1px solid #e8edf0', padding: '14px 14px 14px 58px' }}
      gap="24px"
    >
      {/* Column 1: Fix inputs */}
      <Box direction="vertical" style={{ flex: 1 }} gap="8px">
        <Text size="small" weight="bold">Fix Issues</Text>
        {uniqueFixableFields.length === 0 && (
          <Text size="small" secondary>No directly fixable fields.</Text>
        )}
        {uniqueFixableFields.map((field) => (
          <FormField key={field} label={field.charAt(0).toUpperCase() + field.slice(1)}>
            <Input
              size="small"
              value={fixValues[field] ?? ''}
              onChange={(e) => setFixValues((v) => ({ ...v, [field]: e.target.value }))}
            />
          </FormField>
        ))}
        {uniqueFixableFields.length > 0 && (
          <Box gap="8px" marginTop="4px">
            <Button size="small" skin="light" onClick={() => handleApply('wix')} disabled={applying}>
              Apply to Wix
            </Button>
            <Button size="small" skin="light" onClick={() => handleApply('gmc')} disabled={applying}>
              Apply to GMC
            </Button>
            <Button size="small" onClick={() => handleApply('both')} disabled={applying}>
              {applying ? <Loader size="tiny" /> : 'Apply Both'}
            </Button>
          </Box>
        )}
      </Box>

      {/* Column 2: Current feed values */}
      <Box direction="vertical" style={{ flex: 1 }} gap="4px">
        <Text size="small" weight="bold">Current Feed Values</Text>
        {[
          ['Title', product.name],
          ['Price', product.price ?? '—'],
          ['Availability', product.availability ?? '—'],
          ['Brand', product.brand ?? '—'],
        ].map(([label, value]) => (
          <Box key={label} direction="vertical">
            <Text size="tiny" secondary>{label}</Text>
            <Text size="small">{value}</Text>
          </Box>
        ))}
        {product.imageUrl && (
          <Box direction="vertical" marginTop="4px">
            <Text size="tiny" secondary>Image</Text>
            <img
              src={product.imageUrl}
              alt={product.name}
              style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, marginTop: 4 }}
            />
          </Box>
        )}
      </Box>

      {/* Column 3: SyncStream AI */}
      <Box direction="vertical" style={{ flex: 1 }} gap="8px">
        <Text size="small" weight="bold">SyncStream AI</Text>
        <Box gap="8px" verticalAlign="middle">
          <ToggleSwitch
            size="small"
            checked={product.aiEnabled}
            onChange={(e) => onToggleAI(product.productId, e.target.checked)}
          />
          <Text size="small">{product.aiEnabled ? 'Auto-enhance on sync' : 'Enhancement off'}</Text>
        </Box>
        {product.lastEnhancedAt ? (
          <Text size="tiny" secondary>
            Last enhanced: {new Date(product.lastEnhancedAt).toLocaleDateString()}
          </Text>
        ) : (
          <Text size="tiny" secondary>Not enhanced yet</Text>
        )}
        <Button size="small" skin="light" onClick={handleEnhance} disabled={enhancing}>
          {enhancing ? <Loader size="tiny" /> : '✦ Enhance This Product'}
        </Button>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 4: Implement the main ProductRow component and export**

```tsx
export const ProductRow: FC<ProductRowProps> = ({
  product,
  isExpanded,
  onExpand,
  onApplyFix,
  onToggleAI,
  onEnhanceNow,
}) => {
  const allIssues = [...product.gmcIssues, ...product.metaIssues];
  const hasErrors = allIssues.some((i) => i.severity === 'error');
  const hasWarnings = allIssues.some((i) => i.severity === 'warning');

  return (
    <Box direction="vertical">
      {/* Main row */}
      <Box
        verticalAlign="top"
        gap="8px"
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #f0f2f5',
          background: rowBackground(product),
          cursor: 'pointer',
        }}
        onClick={() => onExpand(isExpanded ? null : product.productId)}
      >
        {/* Thumbnail */}
        <Box
          style={{
            width: 32, height: 32, borderRadius: 4, flexShrink: 0, overflow: 'hidden',
            background: '#e8edf0', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Text size="tiny" secondary>—</Text>
          )}
        </Box>

        {/* Product info + issues */}
        <Box direction="vertical" style={{ flex: 1, minWidth: 0 }}>
          <Text size="small" weight="bold">{product.name}</Text>
          <Text size="tiny" secondary>
            {product.sku ? `SKU: ${product.sku}` : 'No SKU'} · {product.variantCount} variant{product.variantCount !== 1 ? 's' : ''}
          </Text>
          {allIssues.length > 0 && (
            <Box direction="vertical" marginTop="2px" gap="1px">
              {allIssues.map((issue, i) => (
                <Text
                  key={i}
                  size="tiny"
                  style={{ color: issue.severity === 'error' ? '#c62828' : '#c17d00' }}
                >
                  {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                </Text>
              ))}
            </Box>
          )}
        </Box>

        {/* GMC status */}
        <Box style={{ width: 72, flexShrink: 0 }} verticalAlign="top" paddingTop="2px">
          <Text size="tiny" weight="bold" style={{ color: statusColor(product.gmcStatus) }}>
            {statusLabel(product.gmcStatus)}
          </Text>
        </Box>

        {/* Meta status */}
        <Box style={{ width: 72, flexShrink: 0 }} verticalAlign="top" paddingTop="2px">
          <Text size="tiny" weight="bold" style={{ color: statusColor(product.metaStatus) }}>
            {statusLabel(product.metaStatus)}
          </Text>
        </Box>

        {/* AI toggle */}
        <Box style={{ width: 80, flexShrink: 0 }} verticalAlign="top" paddingTop="2px" gap="6px">
          <ToggleSwitch
            size="small"
            checked={product.aiEnabled}
            onChange={(e) => {
              e.stopPropagation();
              onToggleAI(product.productId, e.target.checked);
            }}
          />
          <Text size="tiny" secondary>{product.aiEnabled ? 'Enhanced' : 'Off'}</Text>
        </Box>

        {/* Action */}
        <Box style={{ width: 36, flexShrink: 0 }} verticalAlign="top" paddingTop="2px">
          <Text
            size="tiny"
            weight="bold"
            style={{ color: hasErrors ? '#c62828' : '#116dff', cursor: 'pointer' }}
          >
            {hasErrors || hasWarnings ? 'Fix' : '›'}
          </Text>
        </Box>
      </Box>

      {/* Expanded panel */}
      {isExpanded && (
        <ExpandedPanel
          product={product}
          onApplyFix={onApplyFix}
          onToggleAI={onToggleAI}
          onEnhanceNow={onEnhanceNow}
        />
      )}
    </Box>
  );
};
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/ProductRow.tsx
git commit -m "feat: ProductRow component with expanded fix panel"
```

---

## Task 7: ProductsTab Component

**Files:**
- Create: `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx`

This is the unified product table. It manages filter state, search, and expanded row locally. All data is passed as props from the parent.

- [ ] **Step 1: Create the file with types and helper functions**

```tsx
// src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
import { type FC, useState, useMemo, useEffect } from 'react';
import { Box, Text, Input, Button, Loader } from '@wix/design-system';
import { ProductRow, type ProductRowData, type ApplyFixPayload } from './ProductRow';

interface ProductsTabProps {
  products: ProductRowData[];
  loading: boolean;
  config: { gmcConnected: boolean; metaConnected: boolean } | null;
  onSyncNow: () => Promise<void>;
  onCheckCompliance: () => Promise<void>;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
  initialFilter?: 'all' | 'failed' | 'warnings' | 'synced';
}

type FilterTab = 'all' | 'failed' | 'warnings' | 'synced';
```

- [ ] **Step 2: Implement the component body**

```tsx
export const ProductsTab: FC<ProductsTabProps> = ({
  products,
  loading,
  config,
  onSyncNow,
  onCheckCompliance,
  onApplyFix,
  onToggleAI,
  onEnhanceNow,
  initialFilter = 'all',
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>(initialFilter);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);

  // Reset to initialFilter when it changes (e.g. navigated from dashboard "Fix Issues")
  useEffect(() => { setActiveFilter(initialFilter); }, [initialFilter]);

  const counts = useMemo(() => ({
    all: products.length,
    failed: products.filter((p) => p.gmcStatus === 'error' || p.metaStatus === 'error').length,
    warnings: products.filter((p) =>
      (p.gmcStatus === 'warning' || p.metaStatus === 'warning') &&
      p.gmcStatus !== 'error' && p.metaStatus !== 'error'
    ).length,
    synced: products.filter((p) => p.gmcStatus === 'synced' && p.metaStatus !== 'error').length,
  }), [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (activeFilter === 'failed') {
      list = list.filter((p) => p.gmcStatus === 'error' || p.metaStatus === 'error');
    } else if (activeFilter === 'warnings') {
      list = list.filter((p) =>
        (p.gmcStatus === 'warning' || p.metaStatus === 'warning') &&
        p.gmcStatus !== 'error' && p.metaStatus !== 'error'
      );
    } else if (activeFilter === 'synced') {
      list = list.filter((p) => p.gmcStatus === 'synced' && p.metaStatus !== 'error');
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeFilter, search]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try { await onSyncNow(); } finally { setSyncing(false); }
  };

  const handleCheckCompliance = async () => {
    setChecking(true);
    try { await onCheckCompliance(); } finally { setChecking(false); }
  };

  const filterTabStyle = (tab: FilterTab): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 100,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid',
    borderColor: activeFilter === tab
      ? (tab === 'failed' ? '#f5c6c6' : tab === 'warnings' ? '#f5d67a' : tab === 'synced' ? '#a5d6b0' : '#32536a')
      : '#dfe5eb',
    background: activeFilter === tab
      ? (tab === 'failed' ? '#fce8e8' : tab === 'warnings' ? '#fff8e1' : tab === 'synced' ? '#e8f5ee' : '#32536a')
      : 'white',
    color: activeFilter === tab
      ? (tab === 'failed' ? '#c62828' : tab === 'warnings' ? '#c17d00' : tab === 'synced' ? '#2e7d32' : 'white')
      : '#7a92a5',
  });

  if (loading) {
    return (
      <Box align="center" padding="60px">
        <Loader />
      </Box>
    );
  }

  return (
    <Box direction="vertical" gap="12px">
      {/* Toolbar */}
      <Box gap="8px" verticalAlign="middle" style={{ flexWrap: 'wrap' }}>
        <Box gap="6px">
          {(['all', 'failed', 'warnings', 'synced'] as FilterTab[]).map((tab) => (
            <span
              key={tab}
              style={filterTabStyle(tab)}
              onClick={() => setActiveFilter(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({counts[tab]})
            </span>
          ))}
        </Box>
        <Box style={{ flex: 1, minWidth: 160 }}>
          <Input
            size="small"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Button size="small" skin="light" onClick={handleCheckCompliance} disabled={checking}>
          {checking ? <Loader size="tiny" /> : '⟳ Check All'}
        </Button>
        <Button size="small" onClick={handleSyncNow} disabled={syncing}>
          {syncing ? <Loader size="tiny" /> : '⟳ Sync Now'}
        </Button>
      </Box>

      {/* Table */}
      <Box
        direction="vertical"
        style={{ background: 'white', border: '1px solid #e8edf0', borderRadius: 8, overflow: 'hidden' }}
      >
        {/* Header */}
        <Box
          gap="8px"
          style={{
            padding: '8px 14px',
            background: '#f7f9fb',
            borderBottom: '1px solid #e8edf0',
            display: 'grid',
            gridTemplateColumns: '36px 1fr 72px 72px 80px 36px',
          }}
        >
          <span />
          <Text size="tiny" secondary weight="bold">Product</Text>
          <Text size="tiny" secondary weight="bold">
            {config?.gmcConnected ? 'GMC' : '—'}
          </Text>
          <Text size="tiny" secondary weight="bold">
            {config?.metaConnected ? 'Meta' : '—'}
          </Text>
          <Text size="tiny" secondary weight="bold">AI</Text>
          <span />
        </Box>

        {/* Rows */}
        {filtered.length === 0 ? (
          <Box align="center" padding="40px">
            <Text secondary>
              {products.length === 0
                ? 'No products yet. Pull products to get started.'
                : 'No products match this filter.'}
            </Text>
          </Box>
        ) : (
          filtered.map((product) => (
            <ProductRow
              key={product.productId}
              product={product}
              isExpanded={expandedId === product.productId}
              onExpand={setExpandedId}
              onApplyFix={onApplyFix}
              onToggleAI={onToggleAI}
              onEnhanceNow={onEnhanceNow}
            />
          ))
        )}
      </Box>
    </Box>
  );
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
git commit -m "feat: ProductsTab unified table with filter tabs and no sub-tabs"
```

---

## Task 8: DashboardTab Component

**Files:**
- Create: `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx`

This component renders the Normal dashboard state (stats, health, activity, top issues). It receives all data as props — no internal data fetching.

- [ ] **Step 1: Create the file**

```tsx
// src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx
import { type FC } from 'react';
import { Box, Text, Button, Card, Loader } from '@wix/design-system';
import type { SyncEvent, TopIssue } from '../../../../backend/dataService';

export interface DashboardStats {
  total: number;
  synced: number;
  failed: number;
  warnings: number;
  lastFullSync: string | null;
}

export interface PlatformHealth {
  connected: boolean;
  total: number;
  synced: number;
  errors: number;
  pct: number;
}

interface DashboardTabNormalProps {
  stats: DashboardStats;
  platformHealth: { gmc: PlatformHealth; meta: PlatformHealth };
  topIssues: { gmc: TopIssue[]; meta: TopIssue[] };
  recentEvents: SyncEvent[];
  syncing: boolean;
  onSyncNow: () => void;
  onCheckCompliance: () => void;
  onNavigateToFailed: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function severityDot(severity: string): string {
  switch (severity) {
    case 'success': return '#3db37a';
    case 'error': return '#e53935';
    case 'warning': return '#f5a623';
    default: return '#116dff';
  }
}

export const DashboardTabNormal: FC<DashboardTabNormalProps> = ({
  stats,
  platformHealth,
  topIssues,
  recentEvents,
  syncing,
  onSyncNow,
  onCheckCompliance,
  onNavigateToFailed,
}) => {
  // Merge gmc + meta top issues, deduplicate by field+message, take top 6
  const allTopIssues = [...topIssues.gmc, ...topIssues.meta]
    .reduce<TopIssue[]>((acc, issue) => {
      const key = `${issue.field}||${issue.message}`;
      const existing = acc.find((i) => `${i.field}||${i.message}` === key);
      if (existing) {
        existing.count = Math.max(existing.count, issue.count);
      } else {
        acc.push({ ...issue });
      }
      return acc;
    }, [])
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, 6);

  return (
    <Box direction="vertical" gap="16px">
      {/* Stat cards */}
      <Box gap="12px">
        {[
          { num: stats.total, label: 'Total Products', sub: 'in catalog', color: '#32536a' },
          { num: stats.synced, label: 'Synced', sub: 'to GMC + Meta', color: '#3db37a' },
          { num: stats.failed, label: 'Failed', sub: 'need attention', color: '#e53935' },
          { num: stats.warnings, label: 'Warnings', sub: 'missing SKUs etc.', color: '#f5a623' },
        ].map(({ num, label, sub, color }) => (
          <Card key={label} style={{ flex: 1 }}>
            <Card.Content>
              <Box direction="vertical">
                <Text size="medium" weight="bold" style={{ color, fontSize: 24 }}>{num}</Text>
                <Text size="small" weight="bold">{label}</Text>
                <Text size="tiny" secondary>{sub}</Text>
              </Box>
            </Card.Content>
          </Card>
        ))}
      </Box>

      {/* Feed health */}
      <Card>
        <Card.Header
          title="Feed Health"
          suffix={
            stats.lastFullSync
              ? <Text size="tiny" secondary>Last synced {relativeTime(stats.lastFullSync)}</Text>
              : <Text size="tiny" secondary>Never synced</Text>
          }
        />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="10px">
            {[
              { label: 'Google Merchant Center', health: platformHealth.gmc, color: '#3db37a' },
              { label: 'Meta Catalog', health: platformHealth.meta, color: '#116dff' },
            ].map(({ label, health, color }) => (
              <Box key={label} direction="vertical" gap="4px">
                <Box gap="8px" verticalAlign="middle">
                  <Text size="small" weight="bold" style={{ flex: 1 }}>{label}</Text>
                  {health.connected ? (
                    <Text size="small" weight="bold" style={{ color }}>{health.pct}%</Text>
                  ) : (
                    <Text size="tiny" secondary>Not connected</Text>
                  )}
                </Box>
                {health.connected && (
                  <>
                    <Box
                      style={{ height: 8, background: '#e8edf0', borderRadius: 4, overflow: 'hidden' }}
                    >
                      <Box
                        style={{
                          height: '100%',
                          width: `${health.pct}%`,
                          background: color,
                          borderRadius: 4,
                        }}
                      />
                    </Box>
                    <Text size="tiny" secondary>
                      {health.synced} of {health.total} products passing · {health.errors} errors
                    </Text>
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Card.Content>
      </Card>

      {/* Action buttons */}
      <Box gap="8px">
        <Button onClick={onSyncNow} disabled={syncing}>
          {syncing ? <Loader size="tiny" /> : '⟳ Sync Now'}
        </Button>
        {stats.failed > 0 && (
          <Button skin="light" onClick={onNavigateToFailed} style={{ color: '#c17d00' }}>
            ⚠ Fix Issues ({stats.failed})
          </Button>
        )}
        <Button skin="light" onClick={onCheckCompliance}>
          ✦ Check Compliance
        </Button>
      </Box>

      {/* Two-column: activity + top issues */}
      <Box gap="12px" style={{ alignItems: 'flex-start' }}>
        {/* Recent activity */}
        <Card style={{ flex: 2 }}>
          <Card.Header title="Recent Activity" />
          <Card.Divider />
          <Card.Content>
            {recentEvents.length === 0 ? (
              <Text size="small" secondary>No activity yet.</Text>
            ) : (
              <Box direction="vertical" gap="0">
                {recentEvents.map((event) => (
                  <Box
                    key={event.id}
                    gap="8px"
                    verticalAlign="middle"
                    style={{ padding: '7px 0', borderBottom: '1px solid #f7f9fb' }}
                  >
                    <span
                      style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: severityDot(event.severity),
                        flexShrink: 0, display: 'inline-block',
                      }}
                    />
                    <Text size="small" style={{ flex: 1 }}>{event.message}</Text>
                    <Text size="tiny" secondary>
                      {event.createdAt ? relativeTime(event.createdAt) : ''}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
          </Card.Content>
        </Card>

        {/* Top issues */}
        <Card style={{ flex: 1, minWidth: 240 }}>
          <Card.Header
            title="Top Issues"
            suffix={allTopIssues.length > 0 ? <Text size="tiny" style={{ color: '#e53935', fontWeight: 700 }}>{stats.failed + stats.warnings}</Text> : undefined}
          />
          <Card.Divider />
          <Card.Content>
            {allTopIssues.length === 0 ? (
              <Box gap="6px" verticalAlign="middle">
                <Text size="small" style={{ color: '#3db37a' }}>✓</Text>
                <Text size="small">All products healthy</Text>
              </Box>
            ) : (
              <Box direction="vertical" gap="0">
                {allTopIssues.map((issue, i) => (
                  <Box
                    key={i}
                    gap="8px"
                    verticalAlign="middle"
                    style={{ padding: '6px 0', borderBottom: '1px solid #f7f9fb', justifyContent: 'space-between' }}
                  >
                    <Text size="small">
                      {issue.message} ({issue.count} product{issue.count !== 1 ? 's' : ''})
                    </Text>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: issue.severity === 'error' ? '#fce8e8' : '#fff8e1',
                        color: issue.severity === 'error' ? '#c62828' : '#c17d00',
                        flexShrink: 0,
                      }}
                    >
                      {issue.severity === 'error' ? 'Error' : 'Warning'}
                    </span>
                  </Box>
                ))}
              </Box>
            )}
          </Card.Content>
        </Card>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx
git commit -m "feat: DashboardTabNormal component — stats, health, activity, top issues"
```

---

## Task 9: Wire Up New Components in sync-stream.tsx

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

This is the integration task. The existing `DashboardTab` component (lines ~2312–2516) is renamed to `DashboardTabLegacy` temporarily, then replaced. The existing `ProductsTab` component (lines ~1001–~2188) is replaced with the new import. New state and data fetching are added.

- [ ] **Step 1: Add imports for the new components at the top of sync-stream.tsx**

Find the existing import line:
```typescript
import { FixWizard } from './FixWizard';
```

Replace with:
```typescript
import { FixWizard } from './FixWizard';
import { DashboardTabNormal, type DashboardStats, type PlatformHealth } from './DashboardTab';
import { ProductsTab } from './ProductsTab';
import type { ProductRowData, ApplyFixPayload } from './ProductRow';
import type { SyncEvent, TopIssue } from '../../../../backend/dataService';
```

- [ ] **Step 2: Add SyncStatusData interface after the existing AppConfigData interface**

Find the `SyncSummary` interface (around line 86) and add after it:

```typescript
interface SyncStatusData extends SyncSummary {
  totalWarnings: number;
  platformHealth: {
    gmc: PlatformHealth;
    meta: PlatformHealth;
  };
  topIssues: {
    gmc: TopIssue[];
    meta: TopIssue[];
  };
}
```

- [ ] **Step 3: Add `fetchSyncEvents` API helper**

After the existing `fetchSyncStatus` function (around line 120), add:

```typescript
async function fetchSyncEvents(): Promise<SyncEvent[]> {
  const response = await appFetch('/api/sync-events?instanceId=default&limit=10');
  if (!response.ok) return [];
  const data = await response.json();
  return data.events ?? [];
}
```

- [ ] **Step 4: Update the DashboardTab component to use new components**

Find the `const DashboardTab` definition (around line 2312). Replace the entire `DashboardTab` component (from `const DashboardTab` through its closing `};`) with:

```typescript
const DashboardTab: FC<{
  config: AppConfigData | null;
  onRefresh: () => void;
  onTabChange: (tab: string) => void;
}> = ({ config, onRefresh, onTabChange }) => {
  const [data, setData] = useState<SyncStatusData | null>(null);
  const [recentEvents, setRecentEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    totalProducts: number;
    processed: number;
    currentStatus: string;
    syncedCount: number;
    failedCount: number;
  } | null>(null);
  const [wizardActive, setWizardActive] = useState(false);
  const [productsFilter, setProductsFilter] = useState<'all' | 'failed' | 'warnings' | 'synced'>('all');

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [statusResult, eventsResult] = await Promise.all([
        fetchSyncStatus() as Promise<SyncStatusData>,
        fetchSyncEvents(),
      ]);
      setData(statusResult);
      setRecentEvents(eventsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const pollProgress = useCallback(async () => {
    try {
      const response = await appFetch('/api/sync-progress?instanceId=default');
      const progressData = await response.json();
      if (progressData.progress) {
        setSyncProgress(progressData.progress);
        if (progressData.progress.currentStatus === 'running') {
          setTimeout(pollProgress, 2000);
        }
      }
    } catch { /* ignore polling errors */ }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    pollProgress();
    try {
      await triggerSync();
      setSyncProgress(null);
      await loadData();
    } catch (err) {
      setSyncProgress(null);
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [loadData, pollProgress]);

  const handleSetupConfirmed = useCallback(async () => {
    await loadData();
    await onRefresh();
  }, [onRefresh, loadData]);

  const handleGoToMappingFromSetup = useCallback(() => {
    onRefresh();
    onTabChange('mapping');
  }, [onRefresh, onTabChange]);

  const handleNavigateToFailed = useCallback(() => {
    setProductsFilter('failed');
    onTabChange('products');
  }, [onTabChange]);

  const handleCheckCompliance = useCallback(async () => {
    try {
      await appFetch('/api/compliance-check?instanceId=default');
      await loadData();
    } catch { /* silent */ }
  }, [loadData]);

  if (loading) {
    return (
      <Box align="center" padding="60px">
        <Loader />
      </Box>
    );
  }

  const dashboardState = getDashboardState(config, data);

  if (dashboardState === 'fresh') {
    return <FreshView onTabChange={onTabChange} />;
  }

  if (dashboardState === 'confirm-setup') {
    return (
      <ConfirmSetupScreen
        config={config!}
        onConfirmed={handleSetupConfirmed}
        onGoToMapping={handleGoToMappingFromSetup}
      />
    );
  }

  if (dashboardState === 'setup-mode' && data) {
    if (wizardActive && config) {
      return (
        <FixWizard
          issueGroups={data.issueGroups}
          config={config}
          onComplete={async () => {
            setWizardActive(false);
            await loadData();
            await onRefresh();
          }}
        />
      );
    }
    return (
      <Box direction="vertical" gap="16px">
        <SetupModeView
          syncSummary={data}
          onTabChange={onTabChange}
          onLaunchWizard={() => setWizardActive(true)}
        />
        <Box>
          <Button onClick={handleSync} disabled={syncing} size="small" skin="light">
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        </Box>
        {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      </Box>
    );
  }

  // Normal state: new design
  const stats: DashboardStats = {
    total: (data?.totalSynced ?? 0) + (data?.totalErrors ?? 0) + (data?.totalPending ?? 0),
    synced: data?.totalSynced ?? 0,
    failed: data?.totalErrors ?? 0,
    warnings: data?.totalWarnings ?? 0,
    lastFullSync: data?.lastFullSync ?? null,
  };

  const defaultHealth: PlatformHealth = { connected: false, total: 0, synced: 0, errors: 0, pct: 0 };

  return (
    <Box direction="vertical" gap="16px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {syncProgress && syncProgress.currentStatus === 'running' && (
        <Box direction="vertical" gap="6px">
          <Box gap="6px" verticalAlign="middle">
            <Loader size="tiny" />
            <Text size="small">
              Syncing: {syncProgress.processed} / {syncProgress.totalProducts} products
            </Text>
          </Box>
          <Box height="8px" backgroundColor="#E8E8E8" borderRadius="4px" overflow="hidden">
            <Box
              height="100%"
              width={`${syncProgress.totalProducts > 0 ? Math.round((syncProgress.processed / syncProgress.totalProducts) * 100) : 0}%`}
              backgroundColor="#3B82F6"
              borderRadius="4px"
            />
          </Box>
        </Box>
      )}
      <DashboardTabNormal
        stats={stats}
        platformHealth={{
          gmc: data?.platformHealth?.gmc ?? defaultHealth,
          meta: data?.platformHealth?.meta ?? defaultHealth,
        }}
        topIssues={data?.topIssues ?? { gmc: [], meta: [] }}
        recentEvents={recentEvents}
        syncing={syncing}
        onSyncNow={handleSync}
        onCheckCompliance={handleCheckCompliance}
        onNavigateToFailed={handleNavigateToFailed}
      />
    </Box>
  );
};
```

- [ ] **Step 5: Replace the old ProductsTab component with a thin wrapper around the new one**

Find the old `const ProductsTab: FC<...>` (around line 1001) and replace the entire component (through its closing `};` before `// ─── Settings Tab`) with:

```typescript
const ProductsTab: FC<{ config: AppConfigData | null; onConfigRefresh: () => void; initialFilter?: 'all' | 'failed' | 'warnings' | 'synced' }> = ({
  config,
  initialFilter = 'all',
}) => {
  const [products, setProducts] = useState<ProductRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await appFetch('/api/products?instanceId=default');
      const data = await response.json();
      const rows: ProductRowData[] = (data.products ?? []).map((p: any) => {
        const syncStatus = p.syncStatus;
        const errorLog: Array<{ field: string; message: string; severity: string }> =
          syncStatus?.errorLog ?? [];
        const issues = errorLog.map((e) => ({
          field: e.field,
          message: e.message,
          severity: (e.severity === 'warning' ? 'warning' : 'error') as 'error' | 'warning',
        }));
        return {
          productId: p.productId,
          name: p.name,
          imageUrl: p.imageUrl,
          sku: p.productData?.sku || undefined,
          variantCount: p.variantCount ?? 1,
          price: p.price,
          availability: p.availability,
          brand: p.brand,
          description: p.plainDescription,
          gmcStatus: syncStatus?.status ?? null,
          metaStatus: null, // Phase 4
          gmcIssues: issues,
          metaIssues: [],
          aiEnabled: p.aiEnabled ?? (config?.aiEnhancementEnabled ?? false),
          enhancedTitle: p.enhancedTitle ?? null,
          enhancedDescription: p.enhancedDescription ?? null,
          lastEnhancedAt: null,
        } satisfies ProductRowData;
      });
      setProducts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [config?.aiEnhancementEnabled]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handleSyncNow = useCallback(async () => {
    await triggerSync();
    await loadProducts();
  }, [loadProducts]);

  const handleCheckCompliance = useCallback(async () => {
    await appFetch('/api/compliance-check?instanceId=default');
    await loadProducts();
  }, [loadProducts]);

  const handleApplyFix = useCallback(async ({ productId, fixes, target }: ApplyFixPayload) => {
    if (target === 'wix' || target === 'both') {
      await appFetch('/api/compliance-apply-wix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productId, fixes }),
      });
    }
    if (target === 'gmc' || target === 'both') {
      const entries = Object.entries(fixes).map(([field, value]) => ({ field, value }));
      await appFetch('/api/compliance-apply-gmc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productId, fixes: entries }),
      });
    }
    await loadProducts();
  }, [loadProducts]);

  const handleToggleAI = useCallback(async (_productId: string, _enabled: boolean) => {
    // Phase 4: persist ai_enabled per product to sync_state
    await loadProducts();
  }, [loadProducts]);

  const handleEnhanceNow = useCallback(async (productId: string) => {
    await appFetch('/api/products-enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'default', productIds: [productId] }),
    });
    await loadProducts();
  }, [loadProducts]);

  if (error) {
    return <SectionHelper appearance="danger">{error}</SectionHelper>;
  }

  return (
    <ProductsTab
      products={products}
      loading={loading}
      config={config}
      onSyncNow={handleSyncNow}
      onCheckCompliance={handleCheckCompliance}
      onApplyFix={handleApplyFix}
      onToggleAI={handleToggleAI}
      onEnhanceNow={handleEnhanceNow}
      initialFilter={initialFilter}
    />
  );
};
```

- [ ] **Step 6: Update the render of ProductsTab in the main component to pass productsFilter**

Find in the main return JSX (around line 2833):
```tsx
{activeTab === 'products' && <ProductsTab config={config} onConfigRefresh={loadConfig} />}
```

Replace with:
```tsx
{activeTab === 'products' && (
  <ProductsTab
    config={config}
    onConfigRefresh={loadConfig}
    initialFilter={productsFilter}
  />
)}
```

Note: `productsFilter` is set by `handleNavigateToFailed` in the new DashboardTab. It needs to be hoisted to the root component state. Find where `activeTab` state is declared and add near it:

```typescript
const [productsFilter, setProductsFilter] = useState<'all' | 'failed' | 'warnings' | 'synced'>('all');
```

Then in the DashboardTab's `handleNavigateToFailed`, update to set the parent state. Since DashboardTab doesn't directly touch the parent's `productsFilter`, pass it as a callback:

Update the DashboardTab usage in the main JSX (where `<DashboardTab>` is rendered) to:
```tsx
{activeTab === 'dashboard' && (
  <DashboardTab
    config={config}
    onRefresh={loadConfig}
    onTabChange={(tab) => {
      setActiveTab(tab);
      if (tab === 'products-failed') {
        setProductsFilter('failed');
        setActiveTab('products');
      } else {
        setActiveTab(tab);
      }
    }}
  />
)}
```

And in `handleNavigateToFailed` inside the new DashboardTab component body, call `onTabChange('products-failed')` instead of `onTabChange('products')`:

```typescript
const handleNavigateToFailed = useCallback(() => {
  onTabChange('products-failed');
}, [onTabChange]);
```

- [ ] **Step 7: Remove the old statusColumns variable** (it was used by the old Table in DashboardTab normal state)

Search for `statusColumns` in sync-stream.tsx and delete that variable definition (it's no longer referenced).

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -50
```

Fix any type errors. Common ones to expect:
- `SyncStatusData` extending `SyncSummary` — ensure the extended fields exist
- `productsFilter` not in scope — ensure it's added to root state

- [ ] **Step 9: Start dev server and manually verify the two tabs**

```bash
wix dev
```

Open the dashboard in the dev site browser:
1. Dashboard tab — Normal state shows: 4 stat cards, feed health bars, action buttons, activity feed, top issues
2. Dashboard "Fix Issues" button → navigates to Products tab pre-filtered to Failed
3. Products tab — no sub-tabs, filter pills visible, each product row shows GMC status, inline issues
4. Clicking a failed product row expands the fix panel with inputs pre-populated
5. "Apply Both" calls the existing `/api/compliance-apply-wix` and `/api/compliance-apply-gmc` endpoints

- [ ] **Step 10: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: integrate DashboardTabNormal and unified ProductsTab, remove sub-tabs"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Stat cards (total/synced/failed/warnings) — Task 9
- [x] Feed health bars per platform — Task 8
- [x] Fix Issues button navigates to Products filtered — Task 9
- [x] Check Compliance button — Tasks 8 & 9
- [x] Recent Activity feed — Tasks 2, 3, 5, 8
- [x] Top Issues panel — Tasks 2, 4, 8
- [x] Products filter tabs (All/Failed/Warnings/Synced) — Task 7
- [x] Search box — Task 7
- [x] Inline issue list per product row — Task 6
- [x] GMC + Meta status columns — Task 6
- [x] AI toggle per row — Task 6
- [x] Expanded fix panel: inputs, feed values, AI section — Task 6
- [x] Apply to Wix / GMC / Both — Task 9
- [x] One row expanded at a time — Task 7 (`expandedId` state)
- [x] sync_events DB table — Task 1
- [x] No sub-tabs in Products — Tasks 7, 9
- [x] getDashboardState logic preserved — Task 9

**Type consistency:**
- `ProductRowData` defined in `ProductRow.tsx`, imported in `ProductsTab.tsx` and `sync-stream.tsx` ✓
- `ApplyFixPayload` defined in `ProductRow.tsx`, used in all three ✓
- `DashboardStats`, `PlatformHealth` defined in `DashboardTab.tsx`, imported in `sync-stream.tsx` ✓
- `SyncEvent`, `TopIssue` defined in `dataService.ts`, imported in `DashboardTab.tsx` and `sync-stream.tsx` ✓
- `SyncStatusData` extends `SyncSummary` — both defined in `sync-stream.tsx` ✓
