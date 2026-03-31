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
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { httpClient } from '@wix/essentials';
import { dashboard } from '@wix/dashboard';

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
}

interface SyncRecord {
  productId: string;
  platform: string;
  status: 'synced' | 'error' | 'pending';
  lastSynced: string;
  errorCount: number;
}

interface SyncSummary {
  totalSynced: number;
  totalErrors: number;
  totalPending: number;
  lastFullSync: string | null;
  records: SyncRecord[];
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
  if (!response.ok) throw new Error('Failed to fetch sync status');
  return response.json();
}

async function triggerSync(): Promise<{ total: number; synced: number; failed: number }> {
  const response = await appFetch('/api/sync-trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', platforms: ['gmc'] }),
  });
  if (!response.ok) throw new Error('Sync failed');
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

const ConnectTab: FC<{ config: AppConfigData | null; onRefresh: () => void }> = ({ config, onRefresh }) => {
  const [connecting, setConnecting] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Exchange failed');
    } finally {
      setExchanging(false);
    }
  }, [authCode, onRefresh]);

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
              <Text size="small" skin="success" weight="bold">
                Connected
              </Text>
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

// ─── Status Tab ──────────────────────────────────────────────────────────

const statusColumns = [
  {
    title: 'Product ID',
    render: (row: SyncRecord) => (
      <Text size="small" secondary>{row.productId.slice(0, 8)}...</Text>
    ),
    width: '25%',
  },
  {
    title: 'Platform',
    render: (row: SyncRecord) => (
      <Badge size="small" skin="general">{row.platform.toUpperCase()}</Badge>
    ),
    width: '15%',
  },
  {
    title: 'Status',
    render: (row: SyncRecord) => {
      const skin = row.status === 'synced' ? 'success' : row.status === 'error' ? 'danger' : 'warning';
      return <Badge size="small" skin={skin}>{row.status}</Badge>;
    },
    width: '15%',
  },
  {
    title: 'Last Synced',
    render: (row: SyncRecord) => (
      <Text size="small">{new Date(row.lastSynced).toLocaleString()}</Text>
    ),
    width: '25%',
  },
  {
    title: 'Errors',
    render: (row: SyncRecord) => (
      <Text size="small" skin={row.errorCount > 0 ? 'error' : 'standard'}>
        {row.errorCount}
      </Text>
    ),
    width: '10%',
  },
];

const StatusTab: FC = () => {
  const [data, setData] = useState<SyncSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchSyncStatus();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const result = await triggerSync();
      setSyncResult(
        `Sync complete: ${result.synced} synced, ${result.failed} failed out of ${result.total} total`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  if (loading) {
    return (
      <Box align="center" padding="60px">
        <Loader />
      </Box>
    );
  }

  return (
    <Box direction="vertical" gap="24px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {syncResult && <SectionHelper appearance="success">{syncResult}</SectionHelper>}

      <Box>
        <Button onClick={handleSync} disabled={syncing} size="small">
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      </Box>

      <Box gap="12px">
        <Card>
          <Card.Header title={String(data?.totalSynced ?? 0)} subtitle="Synced" />
        </Card>
        <Card>
          <Card.Header title={String(data?.totalErrors ?? 0)} subtitle="Errors" />
        </Card>
        <Card>
          <Card.Header title={String(data?.totalPending ?? 0)} subtitle="Pending" />
        </Card>
        <Card>
          <Card.Header
            title={data?.lastFullSync ? new Date(data.lastFullSync).toLocaleDateString() : 'Never'}
            subtitle="Last Full Sync"
          />
        </Card>
      </Box>

      <Card>
        <Table data={data?.records ?? []} columns={statusColumns}>
          <TableToolbar>
            <TableToolbar.Title>Sync Records ({data?.records?.length ?? 0})</TableToolbar.Title>
          </TableToolbar>
          <Table.Content />
        </Table>
      </Card>
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
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }, [aiStyle]);

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
    </Box>
  );
};

// ─── Main Tabbed Page ────────────────────────────────────────────────────

const TAB_ITEMS = [
  { id: 'connect', title: 'Connect' },
  { id: 'mapping', title: 'Field Mapping' },
  { id: 'status', title: 'Sync Status' },
  { id: 'settings', title: 'Settings' },
];

const SyncStreamPage: FC = () => {
  const [activeTab, setActiveTab] = useState('connect');
  const [config, setConfig] = useState<AppConfigData | null>(null);
  const [loading, setLoading] = useState(true);

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
    // Debug: log mapped product + config
    appFetch('/api/debug-sync')
      .then((r) => r.json())
      .then((data) => console.log('[SyncStream] DEBUG sync:', JSON.stringify(data, null, 2)))
      .catch((e) => console.error('[SyncStream] DEBUG error:', e));
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
              onClick={(tab) => setActiveTab(String(tab.id))}
              type="compactSide"
            />

            {activeTab === 'connect' && <ConnectTab config={config} onRefresh={loadConfig} />}
            {activeTab === 'mapping' && <MappingTab config={config} />}
            {activeTab === 'status' && <StatusTab />}
            {activeTab === 'settings' && <SettingsTab config={config} onRefresh={loadConfig} />}
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default SyncStreamPage;
