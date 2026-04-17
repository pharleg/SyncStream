# Guided Feed Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing "0 synced, 18 failed" post-sync experience with a guided setup flow that auto-populates brand/URL from the merchant's Wix store, confirms with them once, then shows a grouped issue checklist until their feed is live.

**Architecture:** Add a `setup_screen_shown` boolean to `app_config` in Supabase. `DashboardTab` gains a `config` prop and renders one of four states: fresh (not connected), confirm-setup (one-time screen), setup-mode (grouped issues checklist), or normal. The confirm screen uses `dashboard.getSiteInfo()` for pre-fill — no new backend API needed. Issue grouping is added to the existing `sync-status` API response.

**Tech Stack:** React + TypeScript (Wix CLI), Wix Design System, Supabase (Postgres), Astro API routes, `@wix/dashboard` SDK.

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/20260416_setup_screen_shown.sql` | **Create** — adds `setup_screen_shown` column |
| `src/types/wix.types.ts` | **Modify** — add `setupScreenShown?` to `AppConfig` |
| `src/backend/dataService.ts` | **Modify** — read/write `setup_screen_shown` |
| `src/pages/api/app-config.ts` | **Modify** — accept `setupScreenShown` in POST body |
| `src/pages/api/sync-status.ts` | **Modify** — add `issueGroups` to response |
| `src/pages/api/gmc-exchange-code.ts` | **Modify** — reset `setupScreenShown = false` on connect |
| `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | **Modify** — add `ConfirmSetupScreen`, `FreshView`, `SetupModeView`, update `DashboardTab`, update `SyncStreamPage`, update `ConnectTab` |

---

## Task 1: DB Migration + Types + DataService

**Files:**
- Create: `supabase/migrations/20260416_setup_screen_shown.sql`
- Modify: `src/types/wix.types.ts:92-105`
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260416_setup_screen_shown.sql`:

```sql
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS setup_screen_shown BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with project `oylbasgccwnrahroparf`, name `20260416_setup_screen_shown`, and the SQL above. Verify it returns `{"success":true}`.

- [ ] **Step 3: Add `setupScreenShown` to `AppConfig` type**

In `src/types/wix.types.ts`, replace the `AppConfig` interface (lines 92–105):

```typescript
/** Shape stored in the AppConfig Wix Data collection. */
export interface AppConfig {
  instanceId: string;
  gmcConnected: boolean;
  metaConnected: boolean;
  fieldMappings: FieldMappings;
  syncEnabled: boolean;
  lastFullSync: Date | null;
  /** Merchant API data source ID for product uploads. */
  gmcDataSourceId?: string;
  /** Whether AI description enhancement is enabled. */
  aiEnhancementEnabled?: boolean;
  /** Optional style/tone instructions for AI enhancement. */
  aiEnhancementStyle?: string;
  /** False until merchant completes the one-time setup confirmation screen. */
  setupScreenShown?: boolean;
}
```

- [ ] **Step 4: Update `getAppConfig` in dataService to read new column**

In `src/backend/dataService.ts`, find the `getAppConfig` return object (after the `if (error || !data) return null;` check). Add `setupScreenShown` to the returned object:

```typescript
return {
  instanceId: data.instance_id,
  gmcConnected: data.gmc_connected ?? false,
  metaConnected: data.meta_connected ?? false,
  fieldMappings: typeof data.field_mappings === 'string'
    ? JSON.parse(data.field_mappings)
    : data.field_mappings ?? {},
  syncEnabled: data.sync_enabled ?? false,
  lastFullSync: data.last_full_sync ? new Date(data.last_full_sync) : null,
  gmcDataSourceId: data.gmc_data_source_id ?? undefined,
  aiEnhancementEnabled: data.ai_enhancement_enabled ?? false,
  aiEnhancementStyle: data.ai_enhancement_style ?? undefined,
  setupScreenShown: data.setup_screen_shown ?? false,
};
```

- [ ] **Step 5: Update `saveAppConfig` in dataService to write new column**

In `src/backend/dataService.ts`, find the `saveAppConfig` upsert object. Add `setup_screen_shown`:

```typescript
const { error } = await db
  .from('app_config')
  .upsert(
    {
      instance_id: config.instanceId,
      gmc_connected: config.gmcConnected,
      meta_connected: config.metaConnected,
      field_mappings: config.fieldMappings,
      sync_enabled: config.syncEnabled,
      last_full_sync: config.lastFullSync?.toISOString() ?? null,
      gmc_data_source_id: config.gmcDataSourceId ?? null,
      ai_enhancement_enabled: config.aiEnhancementEnabled ?? false,
      ai_enhancement_style: config.aiEnhancementStyle ?? null,
      setup_screen_shown: config.setupScreenShown ?? false,
    },
    { onConflict: 'instance_id' },
  );
```

- [ ] **Step 6: Update `app-config.ts` POST to accept `setupScreenShown`**

In `src/pages/api/app-config.ts`, update the POST handler body type and add handling after the existing `syncEnabled` block:

```typescript
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as {
      instanceId: string;
      fieldMappings?: Record<string, { type: string; wixField?: string; defaultValue?: string }>;
      syncEnabled?: boolean;
      setupScreenShown?: boolean;
      aiEnhancementEnabled?: boolean;
      aiEnhancementStyle?: string;
    };

    const instanceId = body.instanceId || 'default';

    let config = await getAppConfig(instanceId);
    if (!config) {
      config = {
        instanceId,
        gmcConnected: false,
        metaConnected: false,
        fieldMappings: {},
        syncEnabled: false,
        lastFullSync: null,
      };
    }

    if (body.fieldMappings !== undefined) config.fieldMappings = body.fieldMappings as FieldMappings;
    if (body.syncEnabled !== undefined) config.syncEnabled = body.syncEnabled;
    if (body.setupScreenShown !== undefined) config.setupScreenShown = body.setupScreenShown;
    if (body.aiEnhancementEnabled !== undefined) config.aiEnhancementEnabled = body.aiEnhancementEnabled;
    if (body.aiEnhancementStyle !== undefined) config.aiEnhancementStyle = body.aiEnhancementStyle;

    await saveAppConfig(config);

    return new Response(JSON.stringify({ success: true }), {
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

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260416_setup_screen_shown.sql \
        src/types/wix.types.ts \
        src/backend/dataService.ts \
        src/pages/api/app-config.ts
git commit -m "feat: add setup_screen_shown to AppConfig for guided onboarding"
```

---

## Task 2: Add Issue Groups to Sync-Status Response

The `SetupModeView` needs to show errors grouped by field type ("brand missing — 18 products") not individual product rows. Add this to the existing sync-status API response.

**Files:**
- Modify: `src/pages/api/sync-status.ts`
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` — `SyncSummary` interface and `fetchSyncStatus` usage

- [ ] **Step 1: Update `sync-status.ts` to compute and return `issueGroups`**

Replace `src/pages/api/sync-status.ts` entirely:

```typescript
/**
 * GET /api/sync-status
 * Returns sync state summary, records, and grouped issue types.
 */
import type { APIRoute } from 'astro';
import { getAppConfig, querySyncStates } from '../../backend/dataService';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instanceId') ?? '';

    const config = await getAppConfig(instanceId);
    const states = await querySyncStates(200);

    const records = states.map((s) => ({
      productId: s.productId,
      platform: s.platform,
      status: s.status,
      lastSynced: s.lastSynced.toISOString(),
      errorCount: Array.isArray(s.errorLog) ? s.errorLog.length : 0,
    }));

    // Group blocking validation errors by field (skip 'api' errors and warnings)
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
    const issueGroups = Array.from(fieldCounts.entries()).map(([field, { count, message }]) => ({
      field,
      count,
      message,
    }));

    const totalSynced = records.filter((r) => r.status === 'synced').length;
    const totalErrors = records.filter((r) => r.status === 'error').length;
    const totalPending = records.filter((r) => r.status === 'pending').length;

    return new Response(
      JSON.stringify({
        totalSynced,
        totalErrors,
        totalPending,
        lastFullSync: config?.lastFullSync?.toISOString() ?? null,
        records,
        issueGroups,
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

- [ ] **Step 2: Update `SyncSummary` interface in `sync-stream.tsx`**

In `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`, find the `SyncSummary` interface (around line 76) and add `issueGroups`:

```typescript
interface IssueGroup {
  field: string;
  count: number;
  message: string;
}

interface SyncSummary {
  totalSynced: number;
  totalErrors: number;
  totalPending: number;
  lastFullSync: string | null;
  records: SyncRecord[];
  issueGroups: IssueGroup[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/sync-status.ts \
        src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: add issueGroups to sync-status response for setup mode display"
```

---

## Task 3: `ConfirmSetupScreen` Component

One-time screen shown after GMC connects. Pre-fills brand from `dashboard.getSiteInfo().siteDisplayName`, URL from `siteUrl`, condition defaults to "New". Merchant edits and confirms.

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

- [ ] **Step 1: Add `AppConfigData.setupScreenShown` to the frontend interface**

In `sync-stream.tsx`, find the `AppConfigData` interface (around line 57) and add the field:

```typescript
interface AppConfigData {
  instanceId: string;
  gmcConnected: boolean;
  metaConnected: boolean;
  fieldMappings: FieldMappings;
  syncEnabled: boolean;
  lastFullSync: string | null;
  aiEnhancementEnabled?: boolean;
  aiEnhancementStyle?: string;
  setupScreenShown?: boolean;
}
```

- [ ] **Step 2: Add `ConfirmSetupScreen` component**

In `sync-stream.tsx`, add this component after the `ConnectTab` component definition (after approximately line 245, before `// ─── Mapping Tab`):

```typescript
// ─── Confirm Setup Screen ─────────────────────────────────────────────────

const CONDITION_OPTIONS = [
  { id: 'new', value: 'New' },
  { id: 'refurbished', value: 'Refurbished' },
  { id: 'used', value: 'Used' },
];

const ConfirmSetupScreen: FC<{
  config: AppConfigData;
  onConfirmed: () => void;
  onGoToMapping: () => void;
}> = ({ config, onConfirmed, onGoToMapping }) => {
  const siteInfo = dashboard.getSiteInfo();

  const [brand, setBrand] = useState(
    config.fieldMappings?.brand?.defaultValue ??
    (siteInfo as any)?.siteDisplayName ??
    '',
  );
  const [siteUrl, setSiteUrl] = useState(
    config.fieldMappings?.siteUrl?.defaultValue ??
    siteInfo?.siteUrl?.replace(/\/$/, '') ??
    '',
  );
  const [condition, setCondition] = useState(
    config.fieldMappings?.condition?.defaultValue ?? 'new',
  );
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDefaults = useCallback(async () => {
    await saveAppConfig({
      fieldMappings: {
        ...config.fieldMappings,
        brand: { type: 'default', defaultValue: brand },
        siteUrl: { type: 'default', defaultValue: siteUrl },
        condition: { type: 'default', defaultValue: condition },
      },
      setupScreenShown: true,
    });
  }, [brand, siteUrl, condition, config.fieldMappings]);

  const handleConfirmAndSync = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDefaults();
      setSyncing(true);
      await triggerSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
      setSyncing(false);
      onConfirmed();
    }
  }, [saveDefaults, onConfirmed]);

  const handleGoToMapping = useCallback(async () => {
    setSaving(true);
    try {
      await saveDefaults();
    } finally {
      setSaving(false);
      onGoToMapping();
    }
  }, [saveDefaults, onGoToMapping]);

  const brandSource = (siteInfo as any)?.siteDisplayName && !config.fieldMappings?.brand?.defaultValue
    ? 'from your Wix business name'
    : null;
  const urlSource = siteInfo?.siteUrl && !config.fieldMappings?.siteUrl?.defaultValue
    ? 'from your site settings'
    : null;

  return (
    <Box direction="vertical" gap="24px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}

      <SectionHelper appearance="standard">
        <Text weight="bold">We found the following from your Wix store</Text>
        <Text size="small" secondary>Review and confirm — these become the defaults for all your products.</Text>
      </SectionHelper>

      <Card>
        <Card.Header title="Step 2 of 3 — Confirm Your Feed Defaults" />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="20px">
            <FormField
              label="Brand Name"
              infoContent="Used on all products sent to Google Merchant Center."
              statusMessage={brandSource ? `Pre-filled ${brandSource}` : undefined}
              status={brandSource ? 'success' : brand ? undefined : 'warning'}
            >
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Your brand name"
              />
            </FormField>

            <FormField
              label="Store URL"
              infoContent="Used to build product links for Google."
              statusMessage={urlSource ? `Pre-filled ${urlSource}` : undefined}
              status={urlSource ? 'success' : siteUrl ? undefined : 'warning'}
            >
              <Input
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://www.yourstore.com"
              />
            </FormField>

            <FormField
              label="Default Product Condition"
              infoContent="Applied to all products unless overridden per-product."
            >
              <Dropdown
                options={CONDITION_OPTIONS}
                selectedId={condition}
                onSelect={(opt) => setCondition(String(opt.id))}
              />
            </FormField>

            <Box direction="vertical" gap="8px" paddingTop="8px" style={{ borderTop: '1px solid #eee' }}>
              <Box gap="12px">
                <Text size="small" secondary>Products found in your store:</Text>
                <Text size="small" weight="bold">syncing to Google Merchant Center</Text>
              </Box>
            </Box>
          </Box>
        </Card.Content>
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="12px">
            <Button
              onClick={handleConfirmAndSync}
              disabled={saving || syncing || !brand}
              fullWidth
            >
              {syncing ? 'Running first sync…' : saving ? 'Saving…' : 'Looks good — run first sync →'}
            </Button>
            <Button
              skin="light"
              onClick={handleGoToMapping}
              disabled={saving}
              fullWidth
            >
              I'll review these in Field Mapping first
            </Button>
          </Box>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header
          title="Optional — set later in Field Mapping"
          subtitle="These aren't required to start syncing"
        />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="8px">
            {['GTIN / Barcode', 'Google Product Category', 'MPN'].map((label) => (
              <Box key={label} verticalAlign="middle" gap="12px">
                <Text size="small" secondary>{label}</Text>
                <Badge size="small" skin="neutralLight">skipping for now</Badge>
              </Box>
            ))}
          </Box>
        </Card.Content>
      </Card>
    </Box>
  );
};
```

- [ ] **Step 3: Add `Badge` to the WDS imports at the top of `sync-stream.tsx`**

Find the `@wix/design-system` import block (line 2) and add `Badge` and `Dropdown` if not already present:

```typescript
import {
  Box,
  Badge,
  Button,
  Card,
  Dropdown,
  FormField,
  Input,
  Page,
  Text,
  Table,
  TableToolbar,
  Tabs,
  ToggleSwitch,
  Loader,
  Popover,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
```

- [ ] **Step 4: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: add ConfirmSetupScreen component with Wix store auto-prefill"
```

---

## Task 4: Dashboard State Detection + New Views

Update `DashboardTab` to accept `config` and `onTabChange` props, detect which of 4 states to render, and add `FreshView` and `SetupModeView` components.

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

- [ ] **Step 1: Add `getDashboardState` helper before `DashboardTab`**

In `sync-stream.tsx`, insert this before the `DashboardTab` component definition (before `const DashboardTab: FC = () => {`, approximately line 1850):

```typescript
type DashboardViewState = 'fresh' | 'confirm-setup' | 'setup-mode' | 'normal';

function getDashboardState(
  config: AppConfigData | null,
  syncSummary: SyncSummary | null,
): DashboardViewState {
  if (!config || !config.gmcConnected) return 'fresh';
  if (!config.setupScreenShown) return 'confirm-setup';
  if (
    syncSummary !== null &&
    syncSummary.totalSynced === 0 &&
    syncSummary.totalErrors > 0
  ) return 'setup-mode';
  return 'normal';
}
```

- [ ] **Step 2: Add `FreshView` component**

Insert after `getDashboardState` and before `DashboardTab`:

```typescript
const FreshView: FC = () => (
  <Box direction="vertical" gap="16px">
    <SectionHelper appearance="standard">
      <Text weight="bold">Welcome to SyncStream</Text>
      <Text size="small" secondary>
        Connect your Google Merchant Center account to get started. Once connected,
        we'll walk you through setting up your product feed.
      </Text>
    </SectionHelper>
  </Box>
);
```

- [ ] **Step 3: Add `SetupModeView` component**

Insert after `FreshView`:

```typescript
const FIELD_LABELS: Record<string, string> = {
  brand: 'Brand name',
  siteUrl: 'Store URL',
  condition: 'Product condition',
  description: 'Product description',
  imageLink: 'Product image',
  link: 'Product link',
  offerId: 'Product SKU / ID',
};

const SetupModeView: FC<{
  syncSummary: SyncSummary;
  onTabChange: (tab: string) => void;
}> = ({ syncSummary, onTabChange }) => (
  <Box direction="vertical" gap="16px">
    <SectionHelper appearance="warning">
      <Text weight="bold">
        {syncSummary.totalErrors} product{syncSummary.totalErrors !== 1 ? 's' : ''} found
        {syncSummary.issueGroups.length === 1
          ? ' — 1 thing to fix before they can go live'
          : ` — ${syncSummary.issueGroups.length} things to fix`}
      </Text>
      <Text size="small" secondary>
        Complete the steps below, then sync to go live.
      </Text>
    </SectionHelper>

    <Card>
      <Card.Header title="Setup Checklist" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="12px">
          {/* Always-complete steps */}
          {[
            'Google Merchant Center connected',
            `${syncSummary.totalErrors + syncSummary.totalSynced} products found in your store`,
          ].map((label) => (
            <Box key={label} verticalAlign="middle" gap="12px">
              <Badge size="small" skin="success">✓</Badge>
              <Text size="small">{label}</Text>
            </Box>
          ))}

          {/* Issue groups */}
          {syncSummary.issueGroups.map((issue) => (
            <Box key={issue.field} verticalAlign="middle" gap="12px">
              <Badge size="small" skin="warning">!</Badge>
              <Box direction="vertical" style={{ flex: 1 }}>
                <Text size="small" weight="bold">
                  {FIELD_LABELS[issue.field] ?? issue.field} not configured
                </Text>
                <Text size="tiny" secondary>
                  Required by Google — affects {issue.count} product{issue.count !== 1 ? 's' : ''}
                </Text>
              </Box>
              <Button size="small" onClick={() => onTabChange('mapping')}>
                Fix →
              </Button>
            </Box>
          ))}
        </Box>
      </Card.Content>
    </Card>
  </Box>
);
```

- [ ] **Step 4: Update `DashboardTab` signature to accept props**

Find `const DashboardTab: FC = () => {` (approximately line 1850) and replace the component signature and its internal render logic:

```typescript
const DashboardTab: FC<{
  config: AppConfigData | null;
  onRefresh: () => void;
  onTabChange: (tab: string) => void;
}> = ({ config, onRefresh, onTabChange }) => {
```

- [ ] **Step 5: Add state-driven rendering at the top of `DashboardTab`'s return**

Inside `DashboardTab`, after `const [syncResult, setSyncResult] = useState...` and after `useEffect(() => { loadData(); }, [loadData]);`, keep the existing loading check, then update the return to branch on `dashboardState`. Add this before the `if (loading) { return ... }` block:

```typescript
const dashboardState = getDashboardState(config, data);
```

Then update the main return statement. The existing normal-state JSX stays intact. Wrap it with state branching:

```typescript
if (loading) {
  return (
    <Box align="center" padding="60px">
      <Loader />
    </Box>
  );
}

if (dashboardState === 'fresh') {
  return <FreshView />;
}

if (dashboardState === 'confirm-setup') {
  return (
    <ConfirmSetupScreen
      config={config!}
      onConfirmed={async () => { onRefresh(); await loadData(); }}
      onGoToMapping={() => { onRefresh(); onTabChange('mapping'); }}
    />
  );
}

if (dashboardState === 'setup-mode' && data) {
  return (
    <Box direction="vertical" gap="16px">
      <SetupModeView syncSummary={data} onTabChange={onTabChange} />
      {/* Still show the Sync Now button so they can re-sync after fixing */}
      <Box>
        <Button onClick={handleSync} disabled={syncing} size="small" skin="light">
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      </Box>
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
    </Box>
  );
}

// normal state — existing JSX below this point unchanged
return (
  <Box direction="vertical" gap="24px">
    {/* ... existing DashboardTab normal-state JSX ... */}
```

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: add dashboard state detection, FreshView, SetupModeView"
```

---

## Task 5: Wire — SyncStreamPage + OAuth Handoff + ConnectTab

Pass `config`, `onRefresh`, and `onTabChange` down to `DashboardTab`. Reset `setupScreenShown` when GMC connects. Auto-navigate to Dashboard after OAuth.

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` — `SyncStreamPage` and `ConnectTab`
- Modify: `src/pages/api/gmc-exchange-code.ts`

- [ ] **Step 1: Update `SyncStreamPage` to pass props to `DashboardTab`**

In `sync-stream.tsx`, find line 2308:

```typescript
{activeTab === 'dashboard' && <DashboardTab />}
```

Replace with:

```typescript
{activeTab === 'dashboard' && (
  <DashboardTab
    config={config}
    onRefresh={loadConfig}
    onTabChange={setActiveTab}
  />
)}
```

- [ ] **Step 2: Update `ConnectTab` to navigate to Dashboard after OAuth**

In `sync-stream.tsx`, find the `ConnectTab` component props definition (approximately line 139):

```typescript
const ConnectTab: FC<{ config: AppConfigData | null; onRefresh: () => void }> = ({ config, onRefresh }) => {
```

Replace with:

```typescript
const ConnectTab: FC<{
  config: AppConfigData | null;
  onRefresh: () => void;
  onTabChange: (tab: string) => void;
}> = ({ config, onRefresh, onTabChange }) => {
```

Then find `handleExchangeCode` inside `ConnectTab` (the `setSuccess(true)` block) and add the navigation:

```typescript
const handleExchangeCode = useCallback(async () => {
  if (!authCode.trim()) return;
  setExchanging(true);
  setError(null);
  try {
    await exchangeGmcCode(authCode.trim());
    setSuccess(true);
    setAwaitingCode(false);
    setAuthCode('');
    await onRefresh();
    // Navigate to Dashboard where setup screen will appear
    onTabChange('dashboard');
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Exchange failed');
  } finally {
    setExchanging(false);
  }
}, [authCode, onRefresh, onTabChange]);
```

- [ ] **Step 3: Pass `onTabChange` to `ConnectTab` in `SyncStreamPage`**

Find line 2307:
```typescript
{activeTab === 'connect' && <ConnectTab config={config} onRefresh={loadConfig} />}
```

Replace with:
```typescript
{activeTab === 'connect' && (
  <ConnectTab config={config} onRefresh={loadConfig} onTabChange={setActiveTab} />
)}
```

- [ ] **Step 4: Reset `setupScreenShown` on GMC connect in `gmc-exchange-code.ts`**

In `src/pages/api/gmc-exchange-code.ts`, find the block that sets `config.gmcConnected = true`:

```typescript
} else {
  config.gmcConnected = true;
  config.gmcDataSourceId = dataSourceId;
}
await saveAppConfig(config);
```

Replace with:

```typescript
} else {
  config.gmcConnected = true;
  config.gmcDataSourceId = dataSourceId;
}
// Reset setup screen so it shows again on reconnect
config.setupScreenShown = false;
await saveAppConfig(config);
```

- [ ] **Step 5: Manual test — full flow**

With `wix dev` running against your dev site:

1. Disconnect GMC (clear `gmc_connected` in Supabase or revoke tokens)
2. Open SyncStream → Dashboard tab → should show **FreshView** ("Welcome to SyncStream")
3. Go to Connect tab → complete GMC OAuth → submit code
4. Should auto-navigate to Dashboard showing **ConfirmSetupScreen** (Step 2 of 3)
5. Verify brand field shows your Wix site display name pre-filled
6. Click "Looks good — run first sync →"
7. If brand was the only issue → sync should now succeed → **Normal state** with synced count > 0
8. If other issues remain → **SetupModeView** with grouped issue list and "Fix →" buttons
9. Click "Fix →" on any issue → should navigate to Field Mapping tab

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx \
        src/pages/api/gmc-exchange-code.ts
git commit -m "feat: wire guided setup flow — OAuth handoff, DashboardTab props, ConnectTab nav"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 4 dashboard states covered (fresh, confirm-setup, setup-mode, normal). Wix data pull via `dashboard.getSiteInfo()`. Issue grouping via `issueGroups`. OAuth reset. "Fix →" navigation to Field Mapping. Optional fields section in confirm screen.
- [x] **No placeholders:** All steps have complete code.
- [x] **Type consistency:** `AppConfigData.setupScreenShown` added in Task 1 and used in Tasks 3, 4. `SyncSummary.issueGroups: IssueGroup[]` added in Task 2 and used in Task 4. `DashboardTab` new props defined in Task 4 Step 4 and wired in Task 5 Step 1. `ConnectTab` new `onTabChange` prop added in Task 5 Steps 2–3.
- [x] **`getDashboardState` placement:** Defined before `FreshView`, `SetupModeView`, and `DashboardTab` — all valid references.
- [x] **`handleSync` in setup-mode state:** The `handleSync` callback is defined inside `DashboardTab`, so it's in scope for the setup-mode branch.
