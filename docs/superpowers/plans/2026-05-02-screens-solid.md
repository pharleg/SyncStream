# Screens Solid — Full Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix auth, WDS compliance, UX issues, and dead code across all SyncStream dashboard screens before App Market launch.

**Architecture:** Create two shared lib files (appFetch.ts, constants.ts), delete the dead status page, patch the enhance API, then update each dashboard screen in isolation. No new pages, no layout redesigns — targeted fixes only.

**Tech Stack:** TypeScript, React, Wix CLI (Astro), @wix/design-system, @wix/essentials (httpClient), @wix/stores (productsV3), vitest

**Spec:** `docs/superpowers/specs/2026-05-02-screens-solid-design.md`

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/lib/appFetch.ts` |
| Create | `src/lib/constants.ts` |
| Delete | `src/extensions/dashboard/pages/status/status.tsx` |
| Delete | `src/extensions/dashboard/pages/status/status.extension.ts` |
| Modify | `src/pages/api/enhance.ts` |
| Modify | `src/extensions/dashboard/pages/connect/connect.tsx` |
| Modify | `src/extensions/dashboard/pages/settings/settings.tsx` |
| Modify | `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx` |
| Modify | `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx` |
| Modify | `src/extensions/dashboard/pages/mapping/mapping.tsx` |

---

## Task 1: Shared utilities

**Files:**
- Create: `src/lib/appFetch.ts`
- Create: `src/lib/constants.ts`

- [ ] **Step 1: Create appFetch.ts**

```ts
// src/lib/appFetch.ts
import { httpClient } from '@wix/essentials';

export function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, new URL(import.meta.url).origin).toString();
  return httpClient.fetchWithAuth(url, init);
}
```

- [ ] **Step 2: Create constants.ts**

```ts
// src/lib/constants.ts
export const UPGRADE_URL = 'https://manage.wix.com/upgrade';

// Flip to true when T-001 (Meta OAuth) ships — no redeploy needed
export const META_OAUTH_ENABLED = false;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/appFetch.ts src/lib/constants.ts
git commit -m "feat: add shared appFetch and constants utilities"
```

---

## Task 2: Delete dead status page

**Files:**
- Delete: `src/extensions/dashboard/pages/status/status.tsx`
- Delete: `src/extensions/dashboard/pages/status/status.extension.ts`

These files are not imported in `src/extensions.ts` and the route is not in any nav. Safe to delete.

- [ ] **Step 1: Delete both files**

```bash
rm src/extensions/dashboard/pages/status/status.tsx
rm src/extensions/dashboard/pages/status/status.extension.ts
```

- [ ] **Step 2: Verify build still resolves**

```bash
npm run build 2>&1 | tail -20
```

Expected: no errors referencing status page. If errors appear, grep for any remaining import: `grep -r "status.extension\|pages/status" src/`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete unused status dashboard page"
```

---

## Task 3: enhance.ts GET — add totalCount

**Files:**
- Modify: `src/pages/api/enhance.ts` (GET handler only)

The GET handler currently returns `{ enhancedCount }`. Add `totalCount` (total Wix products) so the settings screen can show "X pending · uses X AI credits".

- [ ] **Step 1: Update the GET handler**

Replace the existing GET export in `src/pages/api/enhance.ts` with:

```ts
export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireAuth(request);
    if (session instanceof Response) return session;
    const { instanceId } = session;

    const { createClient } = await import('@supabase/supabase-js');
    const { secrets } = await import('@wix/secrets');
    const supabaseUrl = (await secrets.getSecretValue('supabase_project_url')).value!;
    const supabaseKey = (await secrets.getSecretValue('supabase_service_role')).value!;
    const db = createClient(supabaseUrl, supabaseKey);

    const { count, error } = await db
      .from('enhanced_content')
      .select('*', { count: 'exact', head: true })
      .eq('instance_id', instanceId);

    if (error) throw new Error(error.message);

    const { productsV3 } = await import('@wix/stores');
    const productsResponse = await productsV3.queryProducts(
      { cursorPaging: { limit: 100 } },
      { fields: [] },
    );
    const totalCount = (productsResponse.products ?? []).length;

    return new Response(JSON.stringify({ enhancedCount: count ?? 0, totalCount }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/api/enhance.ts
git commit -m "feat: add totalCount to enhance GET response for credit estimate"
```

---

## Task 4: connect.tsx

**Files:**
- Modify: `src/extensions/dashboard/pages/connect/connect.tsx`

Three changes: remove debug info from error message, remove Meta plan gate, use constants.

- [ ] **Step 1: Add imports at top of file**

Add to the existing imports block:

```ts
import { UPGRADE_URL, META_OAUTH_ENABLED } from '../../../lib/constants';
```

- [ ] **Step 2: Remove callGetBillingStatus and plan state**

Remove the entire `callGetBillingStatus` function and the `plan` state variable:

```ts
// DELETE this function:
async function callGetBillingStatus(): Promise<{ plan: 'free' | 'pro' } | null> { ... }

// DELETE this state:
const [plan, setPlan] = useState<'free' | 'pro' | null>(null);
```

- [ ] **Step 3: Update Promise.all in useEffect — remove billing call**

Replace:
```ts
Promise.all([callGetAppConfig(), callGetBillingStatus(), callCompleteGmcOAuth()])
  .then(([config, billing, gmcResult]) => {
    if (config) {
      setGmcConnected(config.gmcConnected || gmcResult.connected);
      setMetaConnected(config.metaConnected ?? false);
    } else if (gmcResult.connected) {
      setGmcConnected(true);
    }
    if (!gmcResult.connected && gmcResult.error) {
      setError(`GMC OAuth error: ${gmcResult.error}`);
    }
    if (billing) {
      setPlan(billing.plan);
    }
  })
```

With:
```ts
Promise.all([callGetAppConfig(), callCompleteGmcOAuth()])
  .then(([config, gmcResult]) => {
    if (config) {
      setGmcConnected(config.gmcConnected || gmcResult.connected);
      setMetaConnected(config.metaConnected ?? false);
    } else if (gmcResult.connected) {
      setGmcConnected(true);
    }
    if (!gmcResult.connected && gmcResult.error) {
      setError('Google Merchant Center connection failed. Please try again.');
    }
  })
```

- [ ] **Step 4: Replace Meta card JSX**

Replace the entire `{plan !== 'free' ? (...) : (...)}` conditional with a single card that handles all three states:

```tsx
<Card>
  <Card.Header
    title="Meta Product Catalog"
    subtitle={
      metaConnected
        ? 'Connected'
        : META_OAUTH_ENABLED
        ? 'Connect to sync products to Meta Shopping'
        : 'Available soon — connect GMC first to get started'
    }
    suffix={
      metaConnected ? (
        <Text size="small" skin="success" weight="bold">Connected</Text>
      ) : META_OAUTH_ENABLED ? (
        <Button size="small" disabled>Connect</Button>
      ) : (
        <Text
          size="tiny"
          weight="bold"
          style={{
            background: '#eaf4ff',
            color: '#116dff',
            border: '1px solid #c5deff',
            borderRadius: 100,
            padding: '3px 10px',
            letterSpacing: 0.3,
          }}
        >
          COMING SOON
        </Text>
      )
    }
  />
</Card>
```

- [ ] **Step 5: Fix upgrade URL (if present on connect page)**

Search for `manage.wix.com/app-market` in connect.tsx and replace any occurrence with `UPGRADE_URL`.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/connect/connect.tsx
git commit -m "fix: remove debug leak, Meta plan gate, and wrong upgrade URL from connect page"
```

---

## Task 5: settings.tsx

**Files:**
- Modify: `src/extensions/dashboard/pages/settings/settings.tsx`

Changes: auth fix, label renames, AI credit estimate, remove instanceId from bodies.

- [ ] **Step 1: Replace imports at top of file**

Add to imports:
```ts
import { appFetch } from '../../../lib/appFetch';
```

- [ ] **Step 2: Replace all raw fetch calls with appFetch**

Replace every `fetch('/api/...', ...)` call in the three API helper functions:

```ts
// fetchConfig
async function fetchConfig(): Promise<AppConfig | null> {
  const response = await appFetch('/api/app-config');
  if (!response.ok) return null;
  return response.json();
}

// updateConfig
async function updateConfig(updates: Partial<AppConfig>): Promise<void> {
  const response = await appFetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),  // no instanceId: 'default'
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? 'Failed to save');
  }
}

// triggerFullSync
async function triggerFullSync(): Promise<{ total: number; synced: number; failed: number }> {
  const response = await appFetch('/api/sync-trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platforms: ['gmc'] }),  // no instanceId: 'default'
  });
  if (!response.ok) throw new Error('Sync failed');
  return response.json();
}
```

- [ ] **Step 3: Update enhance fetch calls in the component**

In `useEffect`, replace:
```ts
fetch('/api/enhance?instanceId=default')
  .then((r) => (r.ok ? r.json() : { enhancedCount: 0 }))
  .then((data: { enhancedCount: number }) => setEnhancedCount(data.enhancedCount))
```
With:
```ts
appFetch('/api/enhance')
  .then((r) => (r.ok ? r.json() : { enhancedCount: 0, totalCount: 0 }))
  .then((data: { enhancedCount: number; totalCount: number }) => {
    setEnhancedCount(data.enhancedCount);
    setTotalCount(data.totalCount);
  })
```

In `handleEnhanceAll`, replace:
```ts
const response = await fetch('/api/enhance', { method: 'POST', ... });
```
With:
```ts
const response = await appFetch('/api/enhance', { method: 'POST', ... });
```

- [ ] **Step 4: Add totalCount state**

Add alongside `enhancedCount` state:
```ts
const [totalCount, setTotalCount] = useState(0);
```

- [ ] **Step 5: Rename "Run Full Sync" button label**

In the Manual Sync card, replace:
```tsx
{syncing ? 'Syncing...' : 'Run Full Sync'}
```
With:
```tsx
{syncing ? 'Syncing...' : 'Sync to Channels'}
```

- [ ] **Step 6: Rename AI style label and add credit estimate**

In the AI Enhancement card, replace:
```tsx
<FormField label="Style / Tone (optional)">
```
With:
```tsx
<FormField label="Description Tone (optional)">
```

After the `<Button>Enhance All Descriptions</Button>` and `<Text size="tiny" secondary>` block, replace the existing count display:
```tsx
<Text size="tiny" secondary>
  {enhancedCount > 0
    ? `${enhancedCount} product${enhancedCount === 1 ? '' : 's'} enhanced`
    : 'No products enhanced yet'}
</Text>
```
With:
```tsx
<Box direction="vertical" gap="2px">
  {totalCount > enhancedCount && (
    <Text size="tiny" secondary>
      {totalCount - enhancedCount} product{totalCount - enhancedCount !== 1 ? 's' : ''} pending · uses {totalCount - enhancedCount} AI credit{totalCount - enhancedCount !== 1 ? 's' : ''}
    </Text>
  )}
  <Text size="tiny" secondary>
    {enhancedCount > 0
      ? `${enhancedCount} already enhanced`
      : 'No products enhanced yet'}
  </Text>
</Box>
```

- [ ] **Step 7: Commit**

```bash
git add src/extensions/dashboard/pages/settings/settings.tsx
git commit -m "fix: auth, label renames, AI credit estimate in settings"
```

---

## Task 6: DashboardTab.tsx

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx`

Changes: LinearProgressBar, dynamic skin, Fix Issues button, stat card skins, activity badges, issue pills, billing banner, upgrade URL.

- [ ] **Step 1: Update WDS imports**

Replace existing WDS import line:
```ts
import { Box, Text, Button, Card, Loader } from '@wix/design-system';
```
With:
```ts
import { Box, Text, Button, Card, Loader, LinearProgressBar, Badge, SectionHelper } from '@wix/design-system';
```

Add constants import:
```ts
import { UPGRADE_URL } from '../../../../lib/constants';
```

- [ ] **Step 2: Delete severityDotColor function**

Remove the entire function:
```ts
// DELETE:
function severityDotColor(severity: SyncEvent['severity']): string { ... }
```

- [ ] **Step 3: Replace billing banner with SectionHelper**

Replace the inline-styled billing banner `<Box>`:
```tsx
{billingStatus && (
  <Box
    verticalAlign="middle"
    gap="12px"
    style={{ padding: '8px 14px', background: ..., border: ..., borderRadius: 8 }}
  >
    ...
  </Box>
)}
```
With:
```tsx
{billingStatus && (
  <SectionHelper appearance={billingStatus.plan === 'pro' ? 'success' : 'standard'}>
    <Box verticalAlign="middle" gap="12px">
      <Text size="small" weight="bold">
        {billingStatus.plan === 'pro' ? 'Pro' : 'Free'}
      </Text>
      <Text size="small" style={{ flex: 1 }}>
        AI credits: {billingStatus.creditsRemaining} remaining · resets{' '}
        {new Date(billingStatus.resetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </Text>
      {billingStatus.plan === 'free' && (
        <Button size="tiny" skin="light" onClick={() => window.open(UPGRADE_URL, '_blank')}>
          Upgrade to Pro
        </Button>
      )}
    </Box>
  </SectionHelper>
)}
```

- [ ] **Step 4: Replace stat card hardcoded colors**

Replace the `.map(({ num, label, sub, color }) => ...)` stat card block. Remove the `color` from the data array and use WDS skins:

```tsx
{[
  { num: stats.total, label: 'Total Products', sub: 'in catalog', skin: undefined },
  { num: stats.synced, label: 'Synced', sub: 'to GMC + Meta', skin: 'success' as const },
  { num: stats.failed, label: 'Failed', sub: 'need attention', skin: 'error' as const },
  { num: stats.warnings, label: 'Warnings', sub: 'missing SKUs etc.', skin: 'warning' as const },
].map(({ num, label, sub, skin }) => (
  <Box key={label} style={{ flex: 1 }}>
    <Card>
      <Card.Content>
        <Box direction="vertical">
          <Text size="medium" weight="bold" skin={skin} style={{ fontSize: 24 }}>{num}</Text>
          <Text size="small" weight="bold">{label}</Text>
          <Text size="tiny" secondary>{sub}</Text>
        </Box>
      </Card.Content>
    </Card>
  </Box>
))}
```

- [ ] **Step 5: Replace raw div progress bars with LinearProgressBar**

In the Feed Health card, replace the `<Box style={{ height: 8, background: '#e8edf0' ... }}>` progress bar section:

```tsx
{health.connected && (
  <>
    <LinearProgressBar
      value={health.pct}
      skin={health.errors === 0 ? 'success' : 'warning'}
    />
    <Text size="tiny" secondary>
      {health.synced} of {health.total} products passing · {health.errors} errors
    </Text>
  </>
)}
```

Also remove the hardcoded `color` from the platform health map:
```tsx
// Before:
{ label: 'Google Merchant Center', health: platformHealth.gmc, color: '#3db37a' },
{ label: 'Meta Catalog', health: platformHealth.meta, color: '#116dff' },

// After (color no longer needed):
{ label: 'Google Merchant Center', health: platformHealth.gmc },
{ label: 'Meta Catalog', health: platformHealth.meta },
```

Remove the `color` destructure and the `style={{ color }}` from the percentage text — it will inherit from LinearProgressBar's skin signal.

- [ ] **Step 6: Fix Issues button — remove inline style**

Replace:
```tsx
<Button
  skin="light"
  onClick={onNavigateToFailed}
  style={{ color: '#c17d00', borderColor: '#f5d67a', background: '#fff8e1' }}
>
  Fix Issues ({stats.failed})
</Button>
```
With:
```tsx
<Button skin="light" onClick={onNavigateToFailed}>
  Fix Issues ({stats.failed})
</Button>
```

- [ ] **Step 7: Replace activity feed severity dots with Badge**

Replace the `<span style={{ width: 7, height: 7, borderRadius: '50%', background: severityDotColor(event.severity), ... }} />` with:

```tsx
<Badge
  size="tiny"
  skin={
    event.severity === 'success' ? 'success' :
    event.severity === 'error' ? 'danger' :
    event.severity === 'warning' ? 'warning' : 'standard'
  }
>
  {event.severity}
</Badge>
```

- [ ] **Step 8: Replace issue severity pills with Badge**

Replace the hardcoded `<span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: issue.severity === 'error' ? '#fce8e8' : '#fff8e1', color: ... }}>` with:

```tsx
<Badge size="tiny" skin={issue.severity === 'error' ? 'danger' : 'warning'}>
  {issue.severity === 'error' ? 'Error' : 'Warning'}
</Badge>
```

- [ ] **Step 9: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx
git commit -m "fix: WDS compliance in DashboardTab — LinearProgressBar, Badge, SectionHelper"
```

---

## Task 7: ProductsTab.tsx

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx`

Changes: SegmentedToggle for filter tabs, SectionHelper for billing banner, WDS Text for table header, remove filterTabStyle and hardcoded hex.

- [ ] **Step 1: Update WDS imports**

Replace existing WDS import:
```ts
import { Box, Text, Input, Button, Loader } from '@wix/design-system';
```
With:
```ts
import { Box, Text, Input, Button, Loader, SegmentedToggle, SectionHelper } from '@wix/design-system';
```

Add constants import:
```ts
import { UPGRADE_URL } from '../../../../lib/constants';
```

- [ ] **Step 2: Delete filterTabStyle function**

Remove the entire `filterTabStyle` function (lines ~99–116). It will no longer be needed.

- [ ] **Step 3: Replace billing banner with SectionHelper**

Replace the inline-styled `syncBlocked` banner `<Box>`:
```tsx
{syncBlocked && (
  <Box verticalAlign="middle" gap="12px" style={{ padding: '10px 14px', background: '#fff8e1', ... }}>
    ...
  </Box>
)}
```
With:
```tsx
{syncBlocked && (
  <SectionHelper
    appearance="warning"
    title="Catalog limit reached"
    actionText="Upgrade to Pro"
    onAction={() => window.open(UPGRADE_URL, '_blank')}
  >
    Free plan supports up to 50 products. You have {products.length} — upgrade to resume sync.
  </SectionHelper>
)}
```

- [ ] **Step 4: Replace raw filter buttons with SegmentedToggle**

Replace the `<Box gap="6px">` containing the four raw `<button>` elements with:

```tsx
<SegmentedToggle
  selected={activeFilter}
  onClick={(value: string) => setActiveFilter(value as FilterTab)}
>
  <SegmentedToggle.Button value="all">All ({counts.all})</SegmentedToggle.Button>
  <SegmentedToggle.Button value="failed">Failed ({counts.failed})</SegmentedToggle.Button>
  <SegmentedToggle.Button value="warnings">Warnings ({counts.warnings})</SegmentedToggle.Button>
  <SegmentedToggle.Button value="synced">Synced ({counts.synced})</SegmentedToggle.Button>
</SegmentedToggle>
```

- [ ] **Step 5: Update table header column labels to WDS Text**

The header row already uses `<Text size="tiny" secondary weight="bold">` for most columns — verify these are already WDS Text (not raw spans). The existing code should already be WDS-compliant here; if any raw `<span>` elements remain in the header `<Box>`, replace them with `<Text size="tiny" secondary weight="bold">`.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
git commit -m "fix: WDS compliance in ProductsTab — SegmentedToggle, SectionHelper, remove hardcoded hex"
```

---

## Task 8: mapping.tsx

**Files:**
- Modify: `src/extensions/dashboard/pages/mapping/mapping.tsx`

Changes: auth, remove instanceId from bodies, import types, Rules target field dropdown, Add Rule/Filter UX.

- [ ] **Step 1: Update imports**

Add to existing imports:
```ts
import { appFetch } from '../../../../lib/appFetch';
import type { SyncRule, SyncFilter } from '../../../../types/rules.types';
```

Remove the local `SyncRule` and `SyncFilter` interface definitions (lines ~38–59 in the current file) — they are now imported from the types file.

- [ ] **Step 2: Replace all fetch calls with appFetch and remove instanceId**

```ts
async function fetchMappings(): Promise<FieldMappings> {
  const response = await appFetch('/api/app-config');
  if (!response.ok) return {};
  const config = await response.json();
  return config?.fieldMappings ?? {};
}

async function saveMappings(mappings: FieldMappings): Promise<void> {
  const response = await appFetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fieldMappings: mappings }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? 'Failed to save');
  }
}

async function fetchRules(): Promise<SyncRule[]> {
  const response = await appFetch('/api/rules');
  if (!response.ok) return [];
  return response.json();
}

async function apiSaveRule(rule: Omit<SyncRule, 'id'> & { id?: string }): Promise<void> {
  const response = await appFetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!response.ok) throw new Error('Failed to save rule');
}

async function apiDeleteRule(id: string): Promise<void> {
  const response = await appFetch(`/api/rules?id=${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete rule');
}

async function fetchFilters(): Promise<SyncFilter[]> {
  const response = await appFetch('/api/filters');
  if (!response.ok) return [];
  return response.json();
}

async function apiSaveFilter(filter: Omit<SyncFilter, 'id'> & { id?: string }): Promise<void> {
  const response = await appFetch('/api/filters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  if (!response.ok) throw new Error('Failed to save filter');
}

async function apiDeleteFilter(id: string): Promise<void> {
  const response = await appFetch(`/api/filters?id=${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete filter');
}
```

- [ ] **Step 3: Add platform-aware field options constant**

Add after the existing constants (after `CONDITION_GROUP_OPTIONS`):

```ts
const GMC_FIELDS = [
  'title', 'description', 'price', 'salePrice', 'brand', 'condition',
  'gtin', 'mpn', 'googleProductCategory', 'imageLink', 'availability',
].map((f) => ({ id: f, value: f }));

const META_FIELDS = [
  'title', 'description', 'price', 'salePrice', 'brand', 'condition',
  'gtin', 'mpn', 'retailer_id', 'imageLink', 'availability',
].map((f) => ({ id: f, value: f }));

function getFieldOptions(platform: string) {
  return platform === 'meta' ? META_FIELDS : GMC_FIELDS;
}
```

- [ ] **Step 4: Update handleSaveRule to remove instanceId**

In `handleSaveRule`, replace:
```ts
const rule: SyncRule = {
  instanceId: 'default',
  name: newRule.name,
  ...
};
```
With:
```ts
const rule = {
  name: newRule.name,
  platform: newRule.platform,
  field: newRule.field,
  type: newRule.type,
  expression: buildExpression(newRule.type, exprState),
  order: rules.length,
  enabled: true,
} as const;
```

Same for `handleSaveFilter` — remove `instanceId: 'default'`.

- [ ] **Step 5: Replace "Target Field" Input with Dropdown in rule form**

In the rule form JSX, replace:
```tsx
<FormField label="Target Field">
  <Input size="small" value={newRule.field} onChange={(e) => setNewRule({ ...newRule, field: e.target.value })} placeholder="e.g., title, description, price" />
</FormField>
```
With:
```tsx
<FormField label="Target Field">
  <Dropdown
    size="small"
    options={getFieldOptions(newRule.platform)}
    selectedId={newRule.field || undefined}
    placeholder="Select a field"
    onSelect={(option) => setNewRule({ ...newRule, field: option.id as string })}
  />
</FormField>
```

- [ ] **Step 6: Fix Add Rule UX — button no longer toggles**

Replace the current "Add Rule" button:
```tsx
<Button size="small" onClick={() => setShowRuleForm(!showRuleForm)}>
  {showRuleForm ? 'Cancel' : 'Add Rule'}
</Button>
```
With:
```tsx
<Button size="small" onClick={() => setShowRuleForm(true)} disabled={showRuleForm}>
  Add Rule
</Button>
```

Inside the rule form card, add a Cancel action in the footer after the Save button:
```tsx
<Box gap="8px" verticalAlign="middle">
  <Button size="small" onClick={handleSaveRule} disabled={saving || !newRule.name || !newRule.field}>
    {saving ? 'Saving...' : 'Save Rule'}
  </Button>
  <Button size="small" skin="light" onClick={() => {
    setShowRuleForm(false);
    setNewRule({ name: '', platform: 'both', field: '', type: 'static' });
    setExprState({ staticValue: '', concatValue: '', calcField: '', calcOperator: '+', calcOperand: '' });
  }}>
    Cancel
  </Button>
</Box>
```

- [ ] **Step 7: Same UX fix for Add Filter**

Replace the "Add Filter" button toggle:
```tsx
<Button size="small" onClick={() => setShowFilterForm(!showFilterForm)}>
  {showFilterForm ? 'Cancel' : 'Add Filter'}
</Button>
```
With:
```tsx
<Button size="small" onClick={() => setShowFilterForm(true)} disabled={showFilterForm}>
  Add Filter
</Button>
```

Add Cancel button inside the filter form, same pattern as Step 6 but resetting `newFilter`:
```tsx
<Box gap="8px" verticalAlign="middle">
  <Button size="small" onClick={handleSaveFilter} disabled={saving || !newFilter.name || !newFilter.field}>
    {saving ? 'Saving...' : 'Save Filter'}
  </Button>
  <Button size="small" skin="light" onClick={() => {
    setShowFilterForm(false);
    setNewFilter({ name: '', platform: 'both', field: '', operator: 'equals', value: '', conditionGroup: 'AND' });
  }}>
    Cancel
  </Button>
</Box>
```

- [ ] **Step 8: Commit**

```bash
git add src/extensions/dashboard/pages/mapping/mapping.tsx
git commit -m "fix: auth, types import, field dropdown, Add Rule UX in mapping page"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run tests**

```bash
npm test
```

Expected: all existing tests pass. No new tests are required for this cleanup — UI changes are verified manually.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: zero errors. If errors appear, they will be in files modified by this plan — fix before proceeding.

- [ ] **Step 3: Verify no raw fetch calls remain in dashboard files**

```bash
grep -rn "fetch('/api\|fetch(\`/api" \
  src/extensions/dashboard/pages/connect/connect.tsx \
  src/extensions/dashboard/pages/settings/settings.tsx \
  src/extensions/dashboard/pages/mapping/mapping.tsx
```

Expected: zero results. (connect.tsx uses `connectFetch` which uses `httpClient.fetchWithAuth` — that is correct and should NOT be replaced with appFetch.)

- [ ] **Step 4: Verify no hardcoded hex colors remain in changed files**

```bash
grep -n "#[0-9a-fA-F]\{6\}" \
  src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx \
  src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
```

Expected: zero results (or only hex values inside `constants.ts` / `COMING SOON` badge style which is acceptable during the T-001 transition).

- [ ] **Step 5: Final commit if anything was fixed**

```bash
git add -A
git commit -m "fix: final cleanup — TypeScript errors and remaining hex colors"
```
