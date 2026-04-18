import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Dropdown,
  FormField,
  Input,
  Page,
  Text,
  Badge,
  Table,
  TableToolbar,
  Tabs,
  ToggleSwitch,
  Loader,
  Popover,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { httpClient } from '@wix/essentials';
import { dashboard } from '@wix/dashboard';
import { FixWizard } from './FixWizard';
import { DashboardTabNormal, type DashboardStats, type PlatformHealth } from './DashboardTab';
import { ProductsTab as ProductsTabComponent } from './ProductsTab';
import type { ProductRowData, ApplyFixPayload } from './ProductRow';
import type { SyncEvent, TopIssue } from '../../../../backend/dataService';

async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = new URL(import.meta.url).origin;
  const fullUrl = `${baseUrl}${path}`;
  console.log('[SyncStream] appFetch:', fullUrl);
  try {
    const res = await httpClient.fetchWithAuth(fullUrl, init);
    console.log('[SyncStream] response status:', res.status);
    if (!res.ok) {
      const text = await res.clone().text();
      console.error('[SyncStream] error body:', text);
    }
    return res;
  } catch (err) {
    console.error('[SyncStream] fetch error:', err);
    throw err;
  }
}

const CHANGELOG_URL = 'https://syncstream.app/changelog';

// ─── Shared types & API helpers ──────────────────────────────────────────

interface FieldMapping {
  type: 'customField' | 'default';
  wixField?: string;
  defaultValue?: string;
}
type FieldMappings = Record<string, FieldMapping>;

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
  [key: string]: unknown;
}

interface SyncRecord {
  productId: string;
  platform: string;
  status: 'synced' | 'error' | 'pending';
  lastSynced: string;
  errorCount: number;
  errorMessages: string[];
}

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

async function fetchAppConfig(): Promise<AppConfigData | null> {
  const response = await appFetch('/api/app-config?instanceId=default');
  if (!response.ok) return null;
  return response.json();
}

async function saveAppConfig(updates: Record<string, unknown>): Promise<void> {
  const response = await appFetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', ...updates }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? 'Failed to save');
  }
}

async function fetchSyncStatus(): Promise<SyncSummary> {
  const response = await appFetch('/api/sync-status?instanceId=default');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Failed to fetch sync status');
  }
  return response.json();
}

async function fetchSyncEvents(): Promise<SyncEvent[]> {
  const response = await appFetch('/api/sync-events?instanceId=default&limit=10');
  if (!response.ok) return [];
  const data = await response.json();
  return (data as { events?: SyncEvent[] }).events ?? [];
}

async function triggerSync(): Promise<{ total: number; synced: number; failed: number }> {
  const response = await appFetch('/api/sync-trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', platforms: ['gmc'] }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Sync failed');
  }
  return response.json();
}

async function callInitiateGmcOAuth(): Promise<string> {
  const response = await appFetch('/api/gmc-oauth-init?instanceId=default');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.authUrl;
}

async function exchangeGmcCode(code: string): Promise<void> {
  const response = await appFetch('/api/gmc-exchange-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, instanceId: 'default' }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Exchange failed' }));
    throw new Error(data.error ?? 'Exchange failed');
  }
}

// ─── Connect Tab ─────────────────────────────────────────────────────────

const ConnectTab: FC<{
  config: AppConfigData | null;
  onRefresh: () => void;
  onTabChange: (tab: string) => void;
}> = ({ config, onRefresh, onTabChange }) => {
  const [connecting, setConnecting] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnectGmc = useCallback(async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await saveAppConfig({ gmcConnected: false, setupScreenShown: false });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }, [onRefresh]);

  const handleConnectGmc = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const authUrl = await callInitiateGmcOAuth();
      window.open(authUrl, '_blank');
      setAwaitingCode(true);
      setConnecting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
      setConnecting(false);
    }
  }, []);

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

  return (
    <Box direction="vertical" gap="24px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">Google Merchant Center connected successfully!</SectionHelper>}

      <Card>
        <Card.Header
          title="Google Merchant Center"
          subtitle={
            config?.gmcConnected
              ? 'Connected'
              : 'Connect to sync products to Google Shopping'
          }
          suffix={
            config?.gmcConnected ? (
              <Box gap="12px" verticalAlign="middle">
                <Text size="small" skin="success" weight="bold">Connected</Text>
                <Button
                  size="small"
                  skin="light"
                  onClick={handleDisconnectGmc}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </Box>
            ) : (
              <Button size="small" onClick={handleConnectGmc} disabled={connecting || awaitingCode}>
                {connecting ? 'Connecting...' : 'Connect'}
              </Button>
            )
          }
        />
        {awaitingCode && (
          <>
            <Card.Divider />
            <Card.Content>
              <Box direction="vertical" gap="12px">
                <Text size="small">
                  After approving in the Google tab, copy the <strong>code</strong> parameter from the URL bar (the page will show a 404 — that&apos;s expected). Paste it below:
                </Text>
                <Box gap="12px" verticalAlign="bottom">
                  <Box width="100%">
                    <FormField label="Authorization Code">
                      <Input
                        size="small"
                        placeholder="4/0Aci98E..."
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                      />
                    </FormField>
                  </Box>
                  <Button size="small" onClick={handleExchangeCode} disabled={exchanging || !authCode.trim()}>
                    {exchanging ? 'Connecting...' : 'Submit Code'}
                  </Button>
                </Box>
              </Box>
            </Card.Content>
          </>
        )}
      </Card>

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
    </Box>
  );
};

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
    let syncSuccess = false;
    try {
      await saveDefaults();
      setSyncing(true);
      await triggerSync();
      syncSuccess = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
      setSyncing(false);
      if (syncSuccess) onConfirmed();
    }
  }, [saveDefaults, onConfirmed]);

  const handleGoToMapping = useCallback(async () => {
    setSaving(true);
    let saved = false;
    try {
      await saveDefaults();
      saved = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
      if (saved) onGoToMapping();
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

// ─── Mapping Tab (with Rules & Filters sub-tabs) ────────────────────────

const MAPPING_FIELDS = [
  { key: 'siteUrl', label: 'Site URL', description: 'Your store base URL (e.g. https://www.example.com)', placeholder: 'https://www.example.com' },
  { key: 'brand', label: 'Brand', description: 'Product brand name for GMC', placeholder: 'Your Brand Name' },
  { key: 'condition', label: 'Condition', description: 'Product condition (new, refurbished, used)', placeholder: 'new' },
  { key: 'gtin', label: 'GTIN / UPC', description: 'Map to a Wix custom field if products have barcodes', placeholder: 'barcode' },
  { key: 'mpn', label: 'MPN', description: 'Map to a Wix custom field if available', placeholder: 'mpn' },
  { key: 'googleProductCategory', label: 'Google Product Category', description: 'Google taxonomy category', placeholder: 'Apparel & Accessories > Clothing' },
];

const TYPE_OPTIONS = [
  { id: 'default', value: 'Static Default' },
  { id: 'customField', value: 'Wix Custom Field' },
];

const PLATFORM_OPTIONS = [
  { id: 'both', value: 'Both' },
  { id: 'gmc', value: 'Google Merchant Center' },
  { id: 'meta', value: 'Meta Catalog' },
];

const RULE_TYPE_OPTIONS = [
  { id: 'static', value: 'Static Value' },
  { id: 'concatenate', value: 'Concatenate' },
  { id: 'calculator', value: 'Calculator' },
];

const OPERATOR_OPTIONS = [
  { id: 'equals', value: 'Equals' },
  { id: 'not_equals', value: 'Not Equals' },
  { id: 'contains', value: 'Contains' },
  { id: 'greater_than', value: 'Greater Than' },
  { id: 'less_than', value: 'Less Than' },
];

const CALC_OPERATOR_OPTIONS = [
  { id: '+', value: 'Add (+)' },
  { id: '-', value: 'Subtract (-)' },
  { id: '*', value: 'Multiply (×)' },
  { id: '/', value: 'Divide (÷)' },
];

const CONDITION_GROUP_OPTIONS = [
  { id: 'AND', value: 'AND (all must match)' },
  { id: 'OR', value: 'OR (any match)' },
];

const MAPPING_SUB_TABS = [
  { id: 'fields', title: 'Field Mapping' },
  { id: 'rules', title: 'Rules' },
  { id: 'filters', title: 'Filters' },
];


interface SyncRule {
  id?: string;
  instanceId: string;
  name: string;
  platform: string;
  field: string;
  type: string;
  expression: any;
  order: number;
  enabled: boolean;
}

interface SyncFilter {
  id?: string;
  instanceId: string;
  name: string;
  platform: string;
  field: string;
  operator: string;
  value: string;
  conditionGroup: string;
  order: number;
  enabled: boolean;
}

function buildExpression(type: string, exprState: any): any {
  switch (type) {
    case 'static':
      return { value: exprState.staticValue ?? '' };
    case 'concatenate':
      return {
        parts: (exprState.concatValue ?? '').split(/(\{[^}]+\})/).filter(Boolean).map((part: string) => {
          if (part.startsWith('{') && part.endsWith('}')) {
            return { type: 'field', value: part.slice(1, -1) };
          }
          return { type: 'literal', value: part };
        }),
      };
    case 'calculator':
      return {
        field: exprState.calcField ?? '',
        operator: exprState.calcOperator ?? '+',
        operand: parseFloat(exprState.calcOperand) || 0,
      };
    default:
      return {};
  }
}

const MappingTab: FC<{ config: AppConfigData | null }> = ({ config }) => {
  const [subTab, setSubTab] = useState('fields');
  const [mappings, setMappings] = useState<FieldMappings>(config?.fieldMappings ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Rules state
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', platform: 'both', field: '', type: 'static' });
  const [exprState, setExprState] = useState({ staticValue: '', concatValue: '', calcField: '', calcOperator: '+', calcOperand: '' });

  // Filters state
  const [filters, setFilters] = useState<SyncFilter[]>([]);
  const [showFilterForm, setShowFilterForm] = useState(false);
  const [newFilter, setNewFilter] = useState({ name: '', platform: 'both', field: '', operator: 'equals', value: '', conditionGroup: 'AND' });

  useEffect(() => {
    appFetch('/api/rules?instanceId=default').then((r) => r.json()).then(setRules).catch(() => {});
    appFetch('/api/filters?instanceId=default').then((r) => r.json()).then(setFilters).catch(() => {});
  }, []);

  const reloadRules = useCallback(async () => {
    const r = await appFetch('/api/rules?instanceId=default');
    setRules(await r.json());
  }, []);

  const reloadFilters = useCallback(async () => {
    const r = await appFetch('/api/filters?instanceId=default');
    setFilters(await r.json());
  }, []);

  const updateMapping = useCallback(
    (key: string, update: Partial<FieldMapping>) => {
      setMappings((prev) => ({
        ...prev,
        [key]: { type: 'default', ...prev[key], ...update } as FieldMapping,
      }));
      setSuccess(null);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveAppConfig({ fieldMappings: mappings });
      setSuccess('Mappings saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [mappings]);

  const handleSaveRule = useCallback(async () => {
    setSaving(true); setError(null);
    try {
      await appFetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'default', name: newRule.name, platform: newRule.platform,
          field: newRule.field, type: newRule.type,
          expression: buildExpression(newRule.type, exprState),
          order: rules.length, enabled: true,
        }),
      });
      await reloadRules();
      setShowRuleForm(false);
      setNewRule({ name: '', platform: 'both', field: '', type: 'static' });
      setExprState({ staticValue: '', concatValue: '', calcField: '', calcOperator: '+', calcOperand: '' });
      setSuccess('Rule saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally { setSaving(false); }
  }, [newRule, exprState, rules.length, reloadRules]);

  const handleDeleteRule = useCallback(async (id: string) => {
    try {
      await appFetch(`/api/rules?id=${id}`, { method: 'DELETE' });
      await reloadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  }, [reloadRules]);

  const handleSaveFilter = useCallback(async () => {
    setSaving(true); setError(null);
    try {
      await appFetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'default', name: newFilter.name, platform: newFilter.platform,
          field: newFilter.field, operator: newFilter.operator, value: newFilter.value,
          conditionGroup: newFilter.conditionGroup, order: filters.length, enabled: true,
        }),
      });
      await reloadFilters();
      setShowFilterForm(false);
      setNewFilter({ name: '', platform: 'both', field: '', operator: 'equals', value: '', conditionGroup: 'AND' });
      setSuccess('Filter saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save filter');
    } finally { setSaving(false); }
  }, [newFilter, filters.length, reloadFilters]);

  const handleDeleteFilter = useCallback(async (id: string) => {
    try {
      await appFetch(`/api/filters?id=${id}`, { method: 'DELETE' });
      await reloadFilters();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete filter');
    }
  }, [reloadFilters]);

  return (
    <Box direction="vertical" gap="18px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">{success}</SectionHelper>}

      <Tabs
        items={MAPPING_SUB_TABS}
        activeId={subTab}
        onClick={(tab) => { setSubTab(String(tab.id)); setError(null); setSuccess(null); }}
      />

      {/* ── Field Mapping sub-tab ── */}
      {subTab === 'fields' && (
        <Box direction="vertical" gap="18px">
          <Box>
            <Button onClick={handleSave} disabled={saving} size="small">
              {saving ? 'Saving...' : 'Save Mappings'}
            </Button>
          </Box>
          {MAPPING_FIELDS.map((field) => {
            const mapping = mappings[field.key] ?? { type: 'default' as const };
            return (
              <Card key={field.key}>
                <Card.Header title={field.label} subtitle={field.description} />
                <Card.Divider />
                <Card.Content>
                  <Box gap="12px" verticalAlign="bottom">
                    <Box width="200px">
                      <FormField label="Mapping Type">
                        <Dropdown
                          size="small"
                          options={TYPE_OPTIONS}
                          selectedId={mapping.type ?? 'default'}
                          onSelect={(option) =>
                            updateMapping(field.key, { type: option.id as 'default' | 'customField' })
                          }
                        />
                      </FormField>
                    </Box>
                    <Box>
                      <FormField label={mapping.type === 'customField' ? 'Wix Field Key' : 'Default Value'}>
                        <Input
                          size="small"
                          placeholder={field.placeholder}
                          value={mapping.type === 'customField' ? mapping.wixField ?? '' : mapping.defaultValue ?? ''}
                          onChange={(e) =>
                            updateMapping(field.key, mapping.type === 'customField' ? { wixField: e.target.value } : { defaultValue: e.target.value })
                          }
                        />
                      </FormField>
                    </Box>
                  </Box>
                </Card.Content>
              </Card>
            );
          })}
        </Box>
      )}

      {/* ── Rules sub-tab ── */}
      {subTab === 'rules' && (
        <Box direction="vertical" gap="18px">
          <Box>
            <Button size="small" onClick={() => setShowRuleForm(!showRuleForm)}>
              {showRuleForm ? 'Cancel' : 'Add Rule'}
            </Button>
          </Box>

          {showRuleForm && (
            <Card>
              <Card.Header title="New Rule" />
              <Card.Divider />
              <Card.Content>
                <Box direction="vertical" gap="12px">
                  <Box gap="12px">
                    <FormField label="Name">
                      <Input size="small" value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} placeholder="e.g., Prepend brand to title" />
                    </FormField>
                    <FormField label="Platform">
                      <Dropdown size="small" options={PLATFORM_OPTIONS} selectedId={newRule.platform} onSelect={(o) => setNewRule({ ...newRule, platform: o.id as string })} />
                    </FormField>
                  </Box>
                  <Box gap="12px">
                    <FormField label="Target Field">
                      <Input size="small" value={newRule.field} onChange={(e) => setNewRule({ ...newRule, field: e.target.value })} placeholder="e.g., title, description, price" />
                    </FormField>
                    <FormField label="Rule Type">
                      <Dropdown size="small" options={RULE_TYPE_OPTIONS} selectedId={newRule.type} onSelect={(o) => setNewRule({ ...newRule, type: o.id as string })} />
                    </FormField>
                  </Box>
                  {newRule.type === 'static' && (
                    <FormField label="Value">
                      <Input size="small" value={exprState.staticValue} onChange={(e) => setExprState({ ...exprState, staticValue: e.target.value })} placeholder="e.g., new" />
                    </FormField>
                  )}
                  {newRule.type === 'concatenate' && (
                    <FormField label="Expression (use {fieldName} for field references)">
                      <Input size="small" value={exprState.concatValue} onChange={(e) => setExprState({ ...exprState, concatValue: e.target.value })} placeholder="e.g., {brand} - {title}" />
                    </FormField>
                  )}
                  {newRule.type === 'calculator' && (
                    <Box gap="12px">
                      <FormField label="Source Field">
                        <Input size="small" value={exprState.calcField} onChange={(e) => setExprState({ ...exprState, calcField: e.target.value })} placeholder="e.g., price" />
                      </FormField>
                      <FormField label="Operator">
                        <Dropdown size="small" options={CALC_OPERATOR_OPTIONS} selectedId={exprState.calcOperator} onSelect={(o) => setExprState({ ...exprState, calcOperator: o.id as string })} />
                      </FormField>
                      <FormField label="Operand">
                        <Input size="small" value={exprState.calcOperand} onChange={(e) => setExprState({ ...exprState, calcOperand: e.target.value })} placeholder="e.g., 1.2" />
                      </FormField>
                    </Box>
                  )}
                  <Button size="small" onClick={handleSaveRule} disabled={saving || !newRule.name || !newRule.field}>
                    {saving ? 'Saving...' : 'Save Rule'}
                  </Button>
                </Box>
              </Card.Content>
            </Card>
          )}

          {rules.length === 0 && !showRuleForm && (
            <Card>
              <Card.Content>
                <Text size="small" secondary>No rules configured. Rules transform product data before syncing (e.g., prepend brand to title, adjust prices).</Text>
              </Card.Content>
            </Card>
          )}

          {rules.map((rule) => (
            <Card key={rule.id}>
              <Card.Header
                title={rule.name}
                subtitle={`${rule.type} → ${rule.field} | Platform: ${rule.platform}`}
                suffix={
                  <Box gap="12px" verticalAlign="middle">
                    <ToggleSwitch checked={rule.enabled} size="small" onChange={async () => {
                      await appFetch('/api/rules', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
                      });
                      await reloadRules();
                    }} />
                    <Button size="tiny" skin="destructive" onClick={() => rule.id && handleDeleteRule(rule.id)}>
                      Delete
                    </Button>
                  </Box>
                }
              />
            </Card>
          ))}
        </Box>
      )}

      {/* ── Filters sub-tab ── */}
      {subTab === 'filters' && (
        <Box direction="vertical" gap="18px">
          <Box>
            <Button size="small" onClick={() => setShowFilterForm(!showFilterForm)}>
              {showFilterForm ? 'Cancel' : 'Add Filter'}
            </Button>
          </Box>

          {showFilterForm && (
            <Card>
              <Card.Header title="New Filter" />
              <Card.Divider />
              <Card.Content>
                <Box direction="vertical" gap="12px">
                  <Box gap="12px">
                    <FormField label="Name">
                      <Input size="small" value={newFilter.name} onChange={(e) => setNewFilter({ ...newFilter, name: e.target.value })} placeholder="e.g., Exclude out of stock" />
                    </FormField>
                    <FormField label="Platform">
                      <Dropdown size="small" options={PLATFORM_OPTIONS} selectedId={newFilter.platform} onSelect={(o) => setNewFilter({ ...newFilter, platform: o.id as string })} />
                    </FormField>
                  </Box>
                  <Box gap="12px">
                    <FormField label="Field (dot-path)">
                      <Input size="small" value={newFilter.field} onChange={(e) => setNewFilter({ ...newFilter, field: e.target.value })} placeholder="e.g., inventory.availabilityStatus" />
                    </FormField>
                    <FormField label="Operator">
                      <Dropdown size="small" options={OPERATOR_OPTIONS} selectedId={newFilter.operator} onSelect={(o) => setNewFilter({ ...newFilter, operator: o.id as string })} />
                    </FormField>
                  </Box>
                  <Box gap="12px">
                    <FormField label="Value">
                      <Input size="small" value={newFilter.value} onChange={(e) => setNewFilter({ ...newFilter, value: e.target.value })} placeholder="e.g., OUT_OF_STOCK" />
                    </FormField>
                    <FormField label="Condition Group">
                      <Dropdown size="small" options={CONDITION_GROUP_OPTIONS} selectedId={newFilter.conditionGroup} onSelect={(o) => setNewFilter({ ...newFilter, conditionGroup: o.id as string })} />
                    </FormField>
                  </Box>
                  <Button size="small" onClick={handleSaveFilter} disabled={saving || !newFilter.name || !newFilter.field}>
                    {saving ? 'Saving...' : 'Save Filter'}
                  </Button>
                </Box>
              </Card.Content>
            </Card>
          )}

          {filters.length === 0 && !showFilterForm && (
            <Card>
              <Card.Content>
                <Text size="small" secondary>No filters configured. Filters exclude products from sync (e.g., hide out-of-stock, skip products under $5).</Text>
              </Card.Content>
            </Card>
          )}

          {filters.map((filter) => (
            <Card key={filter.id}>
              <Card.Header
                title={filter.name}
                subtitle={`${filter.field} ${filter.operator} "${filter.value}" (${filter.conditionGroup}) | Platform: ${filter.platform}`}
                suffix={
                  <Box gap="12px" verticalAlign="middle">
                    <ToggleSwitch checked={filter.enabled} size="small" onChange={async () => {
                      await appFetch('/api/filters', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...filter, enabled: !filter.enabled }),
                      });
                      await reloadFilters();
                    }} />
                    <Button size="tiny" skin="destructive" onClick={() => filter.id && handleDeleteFilter(filter.id)}>
                      Delete
                    </Button>
                  </Box>
                }
              />
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
};

// ─── Products Tab (Workbench) ────────────────────────────────────────────

const ProductsTab: FC<{
  config: AppConfigData | null;
  onConfigRefresh: () => void;
  initialFilter?: 'all' | 'failed' | 'warnings' | 'synced';
}> = ({ config, initialFilter = 'all' }) => {
  const [products, setProducts] = useState<ProductRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await appFetch('/api/products?instanceId=default');
      const data = await response.json();
      const rows: ProductRowData[] = ((data as { products?: any[] }).products ?? []).map((p: any) => {
        const syncStatus = p.syncStatus as { status?: string; errorLog?: Array<{ field: string; message: string; severity: string }> } | undefined;
        const errorLog = syncStatus?.errorLog ?? [];
        const issues = errorLog.map((e) => ({
          field: e.field,
          message: e.message,
          severity: (e.severity === 'warning' ? 'warning' : 'error') as 'error' | 'warning',
        }));
        return {
          productId: p.productId as string,
          name: p.name as string,
          imageUrl: p.imageUrl as string | undefined,
          sku: (p.productData?.sku ?? undefined) as string | undefined,
          variantCount: (p.variantCount ?? 1) as number,
          price: p.price as string | undefined,
          availability: p.availability as string | undefined,
          brand: p.brand as string | undefined,
          description: p.plainDescription as string | undefined,
          gmcStatus: (syncStatus?.status ?? null) as ProductRowData['gmcStatus'],
          metaStatus: null,
          gmcIssues: issues,
          metaIssues: [],
          aiEnabled: (p.aiEnabled ?? (config?.aiEnhancementEnabled ?? false)) as boolean,
          enhancedTitle: (p.enhancedTitle ?? null) as string | null,
          enhancedDescription: (p.enhancedDescription ?? null) as string | null,
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
    <ProductsTabComponent
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

// ─── Dashboard Tab (formerly Status Tab) ────────────────────────────────


type DashboardViewState = 'fresh' | 'confirm-setup' | 'setup-mode' | 'normal';

function getDashboardState(
  config: AppConfigData | null,
  syncSummary: SyncSummary | null,
): DashboardViewState {
  if (!config || !config.gmcConnected) return 'fresh';
  if (!config.setupScreenShown) return 'confirm-setup';
  // Stay in setup mode while there are any sync errors, whether validation or API-level
  if (syncSummary !== null && syncSummary.totalErrors > 0) return 'setup-mode';
  return 'normal';
}

const FreshView: FC<{ onTabChange: (tab: string) => void }> = ({ onTabChange }) => (
  <Box direction="vertical" gap="16px">
    <SectionHelper appearance="standard">
      <Text weight="bold">Welcome to SyncStream</Text>
      <Text size="small" secondary>
        Connect your Google Merchant Center account to get started. Once connected,
        we'll walk you through setting up your product feed.
      </Text>
    </SectionHelper>
    <Box>
      <Button onClick={() => onTabChange('connect')}>Connect Google Merchant Center →</Button>
    </Box>
  </Box>
);

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
  onLaunchWizard: () => void;
}> = ({ syncSummary, onTabChange, onLaunchWizard }) => {
  const hasValidationIssues = syncSummary.issueGroups.length > 0;
  const issueCount = syncSummary.issueGroups.length;

  return (
    <Box direction="vertical" gap="16px">
      <SectionHelper appearance="warning">
        <Text weight="bold">
          {syncSummary.totalErrors} product{syncSummary.totalErrors !== 1 ? 's' : ''} couldn't sync
          {hasValidationIssues
            ? issueCount === 1
              ? ' — 1 thing to fix'
              : ` — ${issueCount} things to fix`
            : ' — review errors in the Products tab'}
        </Text>
        <Text size="small" secondary>
          {hasValidationIssues
            ? 'Complete the steps below, then sync again to go live.'
            : 'These products were rejected by Google Merchant Center. Check the Products tab for details on each error.'}
        </Text>
        <Box marginTop="12px">
          <Button onClick={onLaunchWizard} size="small">Fix Issues →</Button>
        </Box>
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

            {/* Fixable validation issue groups */}
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

            {/* API-level errors with no field fix available */}
            {!hasValidationIssues && (
              <Box verticalAlign="middle" gap="12px">
                <Badge size="small" skin="warning">!</Badge>
                <Box direction="vertical" style={{ flex: 1 }}>
                  <Text size="small" weight="bold">
                    {syncSummary.totalErrors} product{syncSummary.totalErrors !== 1 ? 's' : ''} rejected by Google
                  </Text>
                  <Text size="tiny" secondary>
                    See the Products tab for specific error details
                  </Text>
                </Box>
                <Button size="small" onClick={() => onTabChange('products')}>
                  Review →
                </Button>
              </Box>
            )}
          </Box>
        </Card.Content>
      </Card>
    </Box>
  );
};

const DashboardTab: FC<{
  config: AppConfigData | null;
  onRefresh: () => void;
  onTabChange: (tab: string) => void;
}> = ({ config, onRefresh, onTabChange }) => {
  const [data, setData] = useState<SyncSummary | null>(null);
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
  const [recentEvents, setRecentEvents] = useState<SyncEvent[]>([]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [statusResult, eventsResult] = await Promise.all([
        fetchSyncStatus(),
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

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pollProgress = useCallback(async () => {
    try {
      const response = await appFetch('/api/sync-progress?instanceId=default');
      const data = await response.json();
      if (data.progress) {
        setSyncProgress(data.progress);
        if (data.progress.currentStatus === 'running') {
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
    // Load fresh sync data first (shows loader, hides stale setup-mode state),
    // then refresh config so getDashboardState sees the new totals together.
    await loadData();
    await onRefresh();
  }, [onRefresh, loadData]);

  const handleGoToMappingFromSetup = useCallback(() => {
    onRefresh();
    onTabChange('mapping');
  }, [onRefresh, onTabChange]);

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

  // Normal state: new design
  const stats: DashboardStats = {
    total: (data?.totalSynced ?? 0) + (data?.totalErrors ?? 0) + (data?.totalPending ?? 0),
    synced: data?.totalSynced ?? 0,
    failed: data?.totalErrors ?? 0,
    warnings: (data as SyncStatusData | null)?.totalWarnings ?? 0,
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
          gmc: (data as SyncStatusData | null)?.platformHealth?.gmc ?? defaultHealth,
          meta: (data as SyncStatusData | null)?.platformHealth?.meta ?? defaultHealth,
        }}
        topIssues={(data as SyncStatusData | null)?.topIssues ?? { gmc: [], meta: [] }}
        recentEvents={recentEvents}
        syncing={syncing}
        onSyncNow={handleSync}
        onCheckCompliance={handleCheckCompliance}
        onNavigateToFailed={() => onTabChange('products-failed')}
      />
    </Box>
  );
};

// ─── Settings Tab ────────────────────────────────────────────────────────

const SettingsTab: FC<{ config: AppConfigData | null; onRefresh: () => void }> = ({
  config,
  onRefresh,
}) => {
  const [localConfig, setLocalConfig] = useState(config);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedCount, setEnhancedCount] = useState(0);
  const [aiStyle, setAiStyle] = useState(config?.aiEnhancementStyle ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    import('@wix/app-management').then(({ appInstances }) =>
      appInstances.getAppInstance().then((res) => {
        setAppVersion((res.instance?.appVersion ?? '').replace(/^\^/, ''));
      }),
    ).catch(() => {});
  }, []);

  useEffect(() => {
    appFetch('/api/enhance?instanceId=default')
      .then((r) => r.json())
      .then((data) => setEnhancedCount(data.enhancedCount ?? 0))
      .catch(() => {});
  }, []);

  const handleToggleSync = useCallback(async () => {
    if (!localConfig) return;
    const newValue = !localConfig.syncEnabled;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveAppConfig({ syncEnabled: newValue });
      setLocalConfig((prev) => (prev ? { ...prev, syncEnabled: newValue } : prev));
      setSuccess(newValue ? 'Sync enabled — products will sync automatically.' : 'Sync disabled.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [localConfig, onRefresh]);

  const handleToggleAi = useCallback(async () => {
    if (!localConfig) return;
    const newValue = !(localConfig as any).aiEnhancementEnabled;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveAppConfig({ aiEnhancementEnabled: newValue });
      setLocalConfig((prev) => prev ? { ...prev, aiEnhancementEnabled: newValue } as any : prev);
      setSuccess(newValue ? 'AI enhancement enabled.' : 'AI enhancement disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [localConfig]);

  const handleSaveAiStyle = useCallback(async () => {
    setSaving(true);
    try {
      await saveAppConfig({ aiEnhancementStyle: aiStyle });
      onRefresh();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }, [aiStyle, onRefresh]);

  const handleEnhanceAll = useCallback(async () => {
    setEnhancing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await appFetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default' }),
      });
      const data = await response.json();
      setEnhancedCount(data.enhanced ?? 0);
      setSuccess(`Enhanced ${data.enhanced} of ${data.total} products.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally {
      setEnhancing(false);
    }
  }, []);

  const handleFullSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await triggerSync();
      setSuccess(
        `Full sync complete: ${result.synced} synced, ${result.failed} failed out of ${result.total} total.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <Box direction="vertical" gap="24px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">{success}</SectionHelper>}

      <Card>
        <Card.Header
          title="Auto Sync"
          subtitle="Automatically sync products when they are created, updated, or deleted"
        />
        <Card.Divider />
        <Card.Content>
          <Box verticalAlign="middle" gap="12px">
            <ToggleSwitch
              checked={localConfig?.syncEnabled ?? false}
              onChange={handleToggleSync}
              disabled={saving}
            />
            <Text size="small">{localConfig?.syncEnabled ? 'Enabled' : 'Disabled'}</Text>
          </Box>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header title="Connected Platforms" subtitle="Status of your platform connections" />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="12px">
            <Box verticalAlign="middle" gap="12px">
              <Text weight="bold" size="small">Google Merchant Center:</Text>
              <Text size="small" skin={localConfig?.gmcConnected ? 'success' : 'error'}>
                {localConfig?.gmcConnected ? 'Connected' : 'Not Connected'}
              </Text>
            </Box>
            <Box verticalAlign="middle" gap="12px">
              <Text weight="bold" size="small">Meta Product Catalog:</Text>
              <Text size="small" skin={localConfig?.metaConnected ? 'success' : 'error'}>
                {localConfig?.metaConnected ? 'Connected' : 'Not Connected'}
              </Text>
            </Box>
          </Box>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header
          title="AI Description Enhancement"
          subtitle="Use Claude AI to optimize product descriptions for search engines"
        />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="12px">
            <Box verticalAlign="middle" gap="12px">
              <ToggleSwitch
                checked={(localConfig as any)?.aiEnhancementEnabled ?? false}
                onChange={handleToggleAi}
                disabled={saving}
                size="small"
              />
              <Text size="small">
                {(localConfig as any)?.aiEnhancementEnabled ? 'Enabled' : 'Disabled'}
              </Text>
            </Box>
            <FormField label="Style / Tone (optional)">
              <Input
                size="small"
                value={aiStyle}
                onChange={(e) => setAiStyle(e.target.value)}
                onBlur={handleSaveAiStyle}
                placeholder="e.g., professional and concise"
                disabled={saving}
              />
            </FormField>
            <Box verticalAlign="middle" gap="12px">
              <Button size="small" onClick={handleEnhanceAll} disabled={enhancing}>
                {enhancing ? 'Enhancing...' : 'Enhance All Descriptions'}
              </Button>
              <Text size="small" secondary>{enhancedCount} products enhanced</Text>
            </Box>
          </Box>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header
          title="Manual Sync"
          subtitle={
            localConfig?.lastFullSync
              ? `Last full sync: ${new Date(localConfig.lastFullSync).toLocaleString()}`
              : 'No full sync has been run yet'
          }
        />
        <Card.Divider />
        <Card.Content>
          <Button onClick={handleFullSync} disabled={syncing || !localConfig?.gmcConnected}>
            {syncing ? 'Syncing...' : 'Run Full Sync'}
          </Button>
        </Card.Content>
      </Card>

      <Box direction="vertical" gap="6px" paddingTop="12px">
        <Box gap="6px" verticalAlign="middle">
          <Text size="tiny" secondary>SyncStream {appVersion ? `v${appVersion}` : ''}</Text>
          <Text size="tiny" secondary>·</Text>
          <Text size="tiny" skin="standard">
            <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6', textDecoration: 'none' }}>
              What's new
            </a>
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

// ─── Main Tabbed Page ────────────────────────────────────────────────────

const TAB_ITEMS = [
  { id: 'connect', title: 'Connect' },
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'products', title: 'Products' },
  { id: 'mapping', title: 'Field Mapping' },
  { id: 'settings', title: 'Settings' },
];

const SyncStreamPage: FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [config, setConfig] = useState<AppConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [productsFilter, setProductsFilter] = useState<'all' | 'failed' | 'warnings' | 'synced'>('all');

  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchAppConfig();

      // Auto-populate siteUrl from Wix dashboard if not set
      const siteInfo = dashboard.getSiteInfo();
      if (siteInfo?.siteUrl) {
        const currentSiteUrl = data?.fieldMappings?.siteUrl?.defaultValue;
        if (!currentSiteUrl && siteInfo.siteUrl) {
          const siteUrl = siteInfo.siteUrl.replace(/\/$/, ''); // strip trailing slash
          await saveAppConfig({
            fieldMappings: {
              ...(data?.fieldMappings ?? {}),
              siteUrl: { type: 'default', defaultValue: siteUrl },
            },
          });
          // Reload to get updated config
          const updated = await fetchAppConfig();
          setConfig(updated);
          return;
        }
      }

      setConfig(data);
    } catch {
      // Config doesn't exist yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  if (loading) {
    return (
      <WixDesignSystemProvider features={{ newColorsBranding: true }}>
        <Page>
          <Page.Content>
            <Box align="center" padding="60px">
              <Loader />
            </Box>
          </Page.Content>
        </Page>
      </WixDesignSystemProvider>
    );
  }

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header title="SyncStream" subtitle="Sync your Wix products to Google Merchant Center" />
        <Page.Content>
          <Box direction="vertical" gap="24px">
            <Tabs
              items={TAB_ITEMS}
              activeId={activeTab}
              onClick={(tab) => {
                const tabId = String(tab.id);
                if (tabId === 'products') {
                  setProductsFilter('all');
                }
                setActiveTab(tabId);
              }}
              type="compactSide"
            />

            {activeTab === 'connect' && (
              <ConnectTab config={config} onRefresh={loadConfig} onTabChange={setActiveTab} />
            )}
            {activeTab === 'dashboard' && (
              <DashboardTab
                config={config}
                onRefresh={loadConfig}
                onTabChange={(tab) => {
                  if (tab === 'products-failed') {
                    setProductsFilter('failed');
                    setActiveTab('products');
                  } else {
                    setActiveTab(tab);
                  }
                }}
              />
            )}
            {activeTab === 'products' && (
              <ProductsTab
                config={config}
                onConfigRefresh={loadConfig}
                initialFilter={productsFilter}
              />
            )}
            {activeTab === 'mapping' && <MappingTab config={config} />}
            {activeTab === 'settings' && <SettingsTab config={config} onRefresh={loadConfig} />}
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default SyncStreamPage;
