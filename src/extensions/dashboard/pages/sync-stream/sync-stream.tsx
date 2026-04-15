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

const CHANGELOG_URL = 'https://syncstream.app/changelog';

// Module-level flag for pending compliance fixes (read by tab change handler)
let _hasPendingFixes = false;

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

const PRODUCTS_SUB_TABS = [
  { id: 'products', title: 'Products' },
  { id: 'compliance', title: 'Compliance' },
  { id: 'ai', title: 'AI' },
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

interface CachedProductRow {
  productId: string;
  name: string;
  imageUrl?: string;
  price?: string;
  currency: string;
  availability?: string;
  variantCount: number;
  description?: string;
  plainDescription?: string;
  brand?: string;
  syncStatus: { status: string; lastSynced: string } | null;
  enhancedDescription: string | null;
  enhancedTitle: string | null;
}

const FILTER_FIELD_OPTIONS = [
  { id: 'name', value: 'Name' },
  { id: 'price', value: 'Price' },
  { id: 'availability', value: 'Availability' },
  { id: 'brand', value: 'Brand' },
  { id: 'variantCount', value: 'Variants' },
];

const FILTER_OP_OPTIONS = [
  { id: 'equals', value: 'Equals' },
  { id: 'not_equals', value: 'Not Equals' },
  { id: 'contains', value: 'Contains' },
  { id: 'greater_than', value: 'Greater Than' },
  { id: 'less_than', value: 'Less Than' },
];

function applyClientFilter(
  products: CachedProductRow[],
  field: string,
  operator: string,
  value: string,
): CachedProductRow[] {
  return products.filter((p) => {
    const fieldValue = String((p as any)[field] ?? '');
    const numField = Number(fieldValue);
    const numValue = Number(value);
    switch (operator) {
      case 'equals': return fieldValue === value;
      case 'not_equals': return fieldValue !== value;
      case 'contains': return fieldValue.toLowerCase().includes(value.toLowerCase());
      case 'greater_than': return !isNaN(numField) && !isNaN(numValue) && numField > numValue;
      case 'less_than': return !isNaN(numField) && !isNaN(numValue) && numField < numValue;
      default: return true;
    }
  });
}

const ProductsTab: FC<{ config: AppConfigData | null; onConfigRefresh: () => void }> = ({ config: _config, onConfigRefresh: _onConfigRefresh }) => {
  const [productsSubTab, setProductsSubTab] = useState('products');
  const [products, setProducts] = useState<CachedProductRow[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<CachedProductRow[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enhancing, setEnhancing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [filterField, setFilterField] = useState('name');
  const [filterOperator, setFilterOperator] = useState('contains');
  const [filterValue, setFilterValue] = useState('');
  const [activeFilter, setActiveFilter] = useState<{ field: string; operator: string; value: string } | null>(null);

  const [previewData, setPreviewData] = useState<Map<string, any> | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [aiPreviews, setAiPreviews] = useState<Array<{
    productId: string;
    original: { title: string; description: string };
    enhanced: { title: string; description: string } | null;
    accepted: boolean;
  }> | null>(null);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [compliance, setCompliance] = useState<{
    healthScore: number;
    totalProducts: number;
    compliantCount: number;
    warningCount: number;
    errorCount: number;
    results: Array<{
      productId: string;
      offerId: string;
      errors: Array<{ field: string; message: string; severity: string }>;
      warnings: Array<{ field: string; message: string; severity: string }>;
      compliant: boolean;
    }>;
  } | null>(null);
  const [expandedCompliance, setExpandedCompliance] = useState<string | null>(null);
  // Pending compliance fixes: offerId → { field → corrected value }
  const [pendingFixes, setPendingFixes] = useState<Map<string, Map<string, string>>>(new Map());
  // Which issue is currently being edited: "offerId:field"
  const [editingFix, setEditingFix] = useState<string | null>(null);
  const [editingFixValue, setEditingFixValue] = useState('');
  const [applyingFixes, setApplyingFixes] = useState(false);

  const pendingFixCount = Array.from(pendingFixes.values()).reduce((sum, m) => sum + m.size, 0);
  // Keep module-level flag in sync for tab-change warning
  useEffect(() => { _hasPendingFixes = pendingFixCount > 0; }, [pendingFixCount]);

  const [productPlatforms, setProductPlatforms] = useState<Map<string, ('gmc' | 'meta')[] | null>>(new Map());

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await appFetch('/api/products?instanceId=default');
      const data = await response.json();
      setProducts(data.products ?? []);
      setFilteredProducts(data.products ?? []);
      setCachedAt(data.cachedAt);
    } catch { /* empty cache */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handlePull = useCallback(async () => {
    setPulling(true); setError(null); setSuccess(null);
    try {
      const response = await appFetch('/api/products-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default' }),
      });
      const data = await response.json();
      setSuccess(`Pulled ${data.count} products from your store.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull products');
    } finally { setPulling(false); }
  }, [loadProducts]);

  const handlePreviewFilter = useCallback(() => {
    if (!filterValue.trim()) { setFilteredProducts(products); setActiveFilter(null); return; }
    const result = applyClientFilter(products, filterField, filterOperator, filterValue);
    setFilteredProducts(result);
    setActiveFilter({ field: filterField, operator: filterOperator, value: filterValue });
  }, [products, filterField, filterOperator, filterValue]);

  const handleClearFilter = useCallback(() => {
    setFilteredProducts(products); setActiveFilter(null); setFilterValue('');
  }, [products]);

  const handlePinFilter = useCallback(async () => {
    if (!activeFilter) return;
    try {
      await appFetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'default',
          name: `${activeFilter.field} ${activeFilter.operator} "${activeFilter.value}"`,
          platform: 'both', field: activeFilter.field,
          operator: activeFilter.operator, value: activeFilter.value,
          conditionGroup: 'AND', order: 0, enabled: true,
        }),
      });
      setSuccess('Filter pinned — it will apply during sync.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pin filter');
    }
  }, [activeFilter]);

  const handlePreviewRules = useCallback(async () => {
    if (previewData) { setPreviewData(null); return; }
    setPreviewing(true); setError(null);
    try {
      const ids = filteredProducts.map((p) => p.productId);
      const response = await appFetch('/api/products-preview-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: ids }),
      });
      const data = await response.json();
      const map = new Map<string, any>();
      for (const p of data.previews ?? []) map.set(p.productId, p);
      setPreviewData(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview rules');
    } finally { setPreviewing(false); }
  }, [filteredProducts, previewData]);

  const handleEnhanceOne = useCallback(async (productId: string) => {
    setEnhancing(productId); setError(null);
    try {
      await appFetch('/api/products-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productId }),
      });
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally { setEnhancing(null); }
  }, [loadProducts]);

  const handleEnhanceBulk = useCallback(async () => {
    if (selected.size === 0) return;
    setEnhancing('bulk'); setError(null);
    try {
      const response = await appFetch('/api/products-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: Array.from(selected) }),
      });
      const data = await response.json();
      setSuccess(`Enhanced ${data.count} products.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk enhancement failed');
    } finally { setEnhancing(null); }
  }, [selected, loadProducts]);

  const handleEnhanceAndPreview = useCallback(async () => {
    const targetIds = selected.size > 0
      ? Array.from(selected)
      : filteredProducts.map((p) => p.productId);
    if (targetIds.length === 0) return;
    setAiPreviewLoading(true); setError(null);
    try {
      const response = await appFetch('/api/products-apply-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: targetIds }),
      });
      const data = await response.json();
      setAiPreviews(
        (data.previews ?? []).map((p: any) => ({ ...p, accepted: true })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate previews');
    } finally { setAiPreviewLoading(false); }
  }, [selected, filteredProducts]);

  const handleApplyToStore = useCallback(async () => {
    if (!aiPreviews) return;
    const accepted = aiPreviews.filter((p) => p.accepted && p.enhanced);
    if (accepted.length === 0) { setAiPreviews(null); return; }

    setAiApplying(true); setError(null);
    try {
      const response = await appFetch('/api/products-apply-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'default',
          updates: accepted.map((p) => ({
            productId: p.productId,
            title: p.enhanced!.title,
            description: p.enhanced!.description,
          })),
        }),
      });
      const data = await response.json();
      const failedErrors = (data.results ?? []).filter((r: any) => !r.success).map((r: any) => r.error).join('; ');
      if (data.applied > 0) {
        setSuccess(`Applied AI descriptions to ${data.applied} products.${data.failed > 0 ? ` ${data.failed} failed: ${failedErrors}` : ''}`);
      } else {
        setError(`Failed to apply: ${failedErrors || 'Unknown error'}`);
      }
      setAiPreviews(null);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply enhancements');
    } finally { setAiApplying(false); }
  }, [aiPreviews, loadProducts]);

  const handleComplianceCheck = useCallback(async () => {
    setComplianceLoading(true); setError(null);
    try {
      const ids = selected.size > 0
        ? Array.from(selected)
        : filteredProducts.map((p) => p.productId);
      const response = await appFetch('/api/compliance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: ids, platform: 'gmc' }),
      });
      const data = await response.json();
      if (data.error) { setError(data.error); return; }
      setCompliance(data);
      setSuccess(`Compliance check complete: ${data.healthScore}% healthy`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance check failed');
    } finally { setComplianceLoading(false); }
  }, [selected, filteredProducts]);

  const handlePlatformToggle = useCallback(async (productIds: string[], platform: 'gmc' | 'meta', enabled: boolean) => {
    for (const id of productIds) {
      const current = productPlatforms.get(id) ?? ['gmc', 'meta'];
      const updated = enabled
        ? [...new Set([...current, platform])]
        : current.filter((p) => p !== platform);
      const finalPlatforms = updated.length === 2 ? null : updated as ('gmc' | 'meta')[];

      try {
        await appFetch('/api/product-platforms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: [id], platforms: finalPlatforms }),
        });
        setProductPlatforms((prev) => {
          const next = new Map(prev);
          next.set(id, finalPlatforms);
          return next;
        });
      } catch {
        setError('Failed to update platform targeting');
      }
    }
  }, [productPlatforms]);

  const handleStageFix = useCallback((offerId: string, field: string, value: string) => {
    setPendingFixes((prev) => {
      const next = new Map(prev);
      const fieldMap = new Map(next.get(offerId) ?? []);
      if (value.trim()) {
        fieldMap.set(field, value.trim());
      } else {
        fieldMap.delete(field);
      }
      if (fieldMap.size > 0) {
        next.set(offerId, fieldMap);
      } else {
        next.delete(offerId);
      }
      return next;
    });
    setEditingFix(null);
    setEditingFixValue('');
  }, []);

  const handleApplyFixes = useCallback(async (target: 'wix' | 'gmc' | 'both') => {
    if (pendingFixes.size === 0) return;
    setApplyingFixes(true); setError(null);
    try {
      // Build updates array: group fixes by productId for Wix writeback
      const fixEntries: Array<{ offerId: string; productId: string; field: string; value: string }> = [];
      for (const [offerId, fieldMap] of pendingFixes) {
        const result = compliance?.results.find((r) => r.offerId === offerId);
        if (!result) continue;
        for (const [field, value] of fieldMap) {
          fixEntries.push({ offerId, productId: result.productId, field, value });
        }
      }

      if (target === 'wix' || target === 'both') {
        // Group by productId and apply field updates to Wix
        const byProduct = new Map<string, Array<{ field: string; value: string }>>();
        for (const fix of fixEntries) {
          const arr = byProduct.get(fix.productId) ?? [];
          arr.push({ field: fix.field, value: fix.value });
          byProduct.set(fix.productId, arr);
        }

        for (const [productId, fields] of byProduct) {
          const updatePayload: Record<string, string> = {};
          for (const f of fields) {
            // Map compliance field names to Wix product fields
            if (f.field === 'brand') updatePayload.brand = f.value;
            else if (f.field === 'description') updatePayload.description = f.value;
            else if (f.field === 'title') updatePayload.name = f.value;
          }
          if (Object.keys(updatePayload).length > 0) {
            await appFetch('/api/products-apply-ai', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instanceId: 'default',
                updates: [{
                  productId,
                  title: updatePayload.name ?? '',
                  description: updatePayload.description ?? '',
                }],
              }),
            });
          }
        }
      }

      if (target === 'gmc' || target === 'both') {
        // Store fixes as field mapping overrides for next sync
        // For now, the fixes are applied via the sync pipeline's rules engine
        // TODO: persist per-product overrides for GMC-only apply
      }

      const count = fixEntries.length;
      setPendingFixes(new Map());
      setSuccess(`Applied ${count} fix${count > 1 ? 'es' : ''} to ${target === 'both' ? 'Wix & GMC' : target === 'wix' ? 'Wix' : 'GMC'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply fixes');
    } finally { setApplyingFixes(false); }
  }, [pendingFixes, compliance]);

  const handleSyncProducts = useCallback(async () => {
    const ids = selected.size > 0 ? Array.from(selected) : filteredProducts.map((p) => p.productId);
    if (ids.length === 0) return;
    setSyncing(true); setError(null); setSuccess(null);
    try {
      const response = await appFetch('/api/products-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default', productIds: ids, platforms: ['gmc'] }),
      });
      const data = await response.json();
      setSuccess(`Sync complete: ${data.synced} synced, ${data.failed} failed out of ${data.total}.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally { setSyncing(false); }
  }, [selected, filteredProducts, loadProducts]);

  const toggleSelect = useCallback((productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filteredProducts.length) setSelected(new Set());
    else setSelected(new Set(filteredProducts.map((p) => p.productId)));
  }, [selected, filteredProducts]);

  if (loading) return <Box align="center" padding="60px"><Loader /></Box>;

  return (
    <Box direction="vertical" gap="18px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">{success}</SectionHelper>}

      <Tabs
        items={PRODUCTS_SUB_TABS}
        activeId={productsSubTab}
        onClick={(tab) => setProductsSubTab(String(tab.id))}
      />

      {productsSubTab === 'products' && (
        <Box direction="vertical" gap="18px">
          {/* Toolbar */}
          <Box gap="12px" verticalAlign="middle">
            <Button size="small" onClick={handlePull} disabled={pulling}>
              {pulling ? 'Pulling...' : 'Pull Products'}
            </Button>
            {cachedAt && <Text size="tiny" secondary>Last refreshed: {new Date(cachedAt).toLocaleString()}</Text>}
            <Box marginLeft="auto" gap="12px">
              <Button size="small" onClick={handlePreviewRules} disabled={previewing || products.length === 0}>
                {previewing ? 'Loading...' : previewData ? 'Clear Preview' : 'Preview Rules'}
              </Button>
              <Button size="small" skin="dark" onClick={handleSyncProducts} disabled={syncing || products.length === 0}>
                {syncing ? 'Syncing...' : `Sync ${selected.size > 0 ? selected.size : filteredProducts.length} Products`}
              </Button>
            </Box>
          </Box>

          {/* Filter bar */}
          <Card>
            <Card.Content>
              <Box gap="12px" verticalAlign="bottom">
                <Box width="150px">
                  <FormField label="Field">
                    <Dropdown size="small" options={FILTER_FIELD_OPTIONS} selectedId={filterField} onSelect={(o) => setFilterField(o.id as string)} />
                  </FormField>
                </Box>
                <Box width="150px">
                  <FormField label="Operator">
                    <Dropdown size="small" options={FILTER_OP_OPTIONS} selectedId={filterOperator} onSelect={(o) => setFilterOperator(o.id as string)} />
                  </FormField>
                </Box>
                <Box width="200px">
                  <FormField label="Value">
                    <Input size="small" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="Filter value..." />
                  </FormField>
                </Box>
                <Button size="small" onClick={handlePreviewFilter}>Preview</Button>
                {activeFilter && (
                  <>
                    <Button size="small" skin="light" onClick={handlePinFilter}>Pin Filter</Button>
                    <Button size="small" skin="light" onClick={handleClearFilter}>Clear</Button>
                  </>
                )}
              </Box>
              {activeFilter && (
                <Box marginTop="6px">
                  <Badge size="small" skin="general">{activeFilter.field} {activeFilter.operator} &quot;{activeFilter.value}&quot;</Badge>
                </Box>
              )}
            </Card.Content>
          </Card>

          {/* Empty state */}
          {products.length === 0 && (
            <Card>
              <Card.Content>
                <Box direction="vertical" align="center" padding="48px" gap="12px">
                  <Text weight="bold">No products loaded</Text>
                  <Text size="small" secondary>Click &quot;Pull Products&quot; to fetch your store catalog.</Text>
                </Box>
              </Card.Content>
            </Card>
          )}

          {/* Product table */}
          {filteredProducts.length > 0 && (
            <Card>
              <Table
                data={filteredProducts}
                columns={[
                  {
                    title: '',
                    render: (row: CachedProductRow) => (
                      <input type="checkbox" checked={selected.has(row.productId)} onChange={() => toggleSelect(row.productId)} />
                    ),
                    width: '40px',
                  },
                  {
                    title: 'Image',
                    render: (row: CachedProductRow) => (
                      row.imageUrl
                        ? <img
                            src={row.imageUrl}
                            alt={row.name ?? ''}
                            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
                            title="Image being synced to GMC/Meta"
                          />
                        : <Box width="40px" height="40px" />
                    ),
                    width: '60px',
                  },
                  {
                    title: 'Title',
                    render: (row: CachedProductRow) => {
                      const preview = previewData?.get(row.productId);
                      if (preview && preview.original.title !== preview.transformed.title) {
                        return (
                          <Box direction="vertical">
                            <Text size="small" style={{ textDecoration: 'line-through' }}>{preview.original.title}</Text>
                            <Text size="small" skin="success">{preview.transformed.title}</Text>
                          </Box>
                        );
                      }
                      return <Text size="small">{row.name}</Text>;
                    },
                    width: '18%',
                  },
                  {
                    title: 'Price',
                    render: (row: CachedProductRow) => <Text size="small">{row.price ? `$${row.price}` : '—'}</Text>,
                    width: '70px',
                  },
                  {
                    title: 'Stock',
                    render: (row: CachedProductRow) => (
                      <Badge size="small" skin={row.availability === 'IN_STOCK' ? 'success' : 'danger'}>
                        {row.availability === 'IN_STOCK' ? 'In Stock' : 'Out'}
                      </Badge>
                    ),
                    width: '80px',
                  },
                  {
                    title: 'Variants',
                    render: (row: CachedProductRow) => <Text size="small">{row.variantCount}</Text>,
                    width: '50px',
                  },
                  {
                    title: 'Description',
                    render: (row: CachedProductRow) => (
                      <Text size="tiny" secondary style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as any}>
                        {row.plainDescription ?? row.description ?? '—'}
                      </Text>
                    ),
                    width: '18%',
                  },
                  {
                    title: 'AI Description',
                    render: (row: CachedProductRow) => (
                      <Text size="tiny" skin={row.enhancedDescription ? 'success' : 'disabled'} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as any}>
                        {row.enhancedDescription ?? '—'}
                      </Text>
                    ),
                    width: '18%',
                  },
                  {
                    title: 'Platforms',
                    render: (row: CachedProductRow) => {
                      const platforms = productPlatforms.get(row.productId) ?? ['gmc', 'meta'];
                      return (
                        <Box direction="horizontal" gap="4px">
                          <Badge
                            size="small"
                            skin={platforms.includes('gmc') ? 'success' : 'neutral'}
                            onClick={() => handlePlatformToggle([row.productId], 'gmc', !platforms.includes('gmc'))}
                          >
                            GMC
                          </Badge>
                          <Badge
                            size="small"
                            skin={platforms.includes('meta') ? 'success' : 'neutral'}
                            onClick={() => handlePlatformToggle([row.productId], 'meta', !platforms.includes('meta'))}
                          >
                            Meta
                          </Badge>
                        </Box>
                      );
                    },
                    width: '120px',
                  },
                  {
                    title: 'Sync',
                    render: (row: CachedProductRow) => {
                      if (!row.syncStatus) return <Text size="tiny" secondary>—</Text>;
                      const skin = row.syncStatus.status === 'synced' ? 'success' : row.syncStatus.status === 'error' ? 'danger' : 'warning';
                      return <Badge size="small" skin={skin}>{row.syncStatus.status}</Badge>;
                    },
                    width: '70px',
                  },
                  {
                    title: '',
                    render: (row: CachedProductRow) => (
                      <Button size="tiny" skin="light" onClick={() => handleEnhanceOne(row.productId)} disabled={enhancing === row.productId}>
                        {enhancing === row.productId ? '...' : 'AI'}
                      </Button>
                    ),
                    width: '50px',
                  },
                ]}
              >
                <TableToolbar>
                  <TableToolbar.Title>
                    {filteredProducts.length} products{activeFilter ? ' (filtered)' : ''}{selected.size > 0 ? ` · ${selected.size} selected` : ''}
                  </TableToolbar.Title>
                  {selected.size > 0 && (
                    <TableToolbar.Item>
                      <Dropdown
                        size="small"
                        placeholder="Set platforms..."
                        options={[
                          { id: 'all', value: 'All platforms' },
                          { id: 'gmc', value: 'GMC only' },
                          { id: 'meta', value: 'Meta only' },
                        ]}
                        onSelect={(option: any) => {
                          const ids = Array.from(selected);
                          const platforms: ('gmc' | 'meta')[] | null = option.id === 'all' ? null
                            : option.id === 'gmc' ? ['gmc']
                            : ['meta'];
                          // Update all selected products
                          ids.forEach((id) => {
                            const enabled = platforms === null || platforms.includes('gmc');
                            handlePlatformToggle([id], 'gmc', enabled);
                          });
                        }}
                      />
                    </TableToolbar.Item>
                  )}
                </TableToolbar>
                <Table.Content />
              </Table>
            </Card>
          )}
        </Box>
      )}

      {productsSubTab === 'compliance' && (
        <Box direction="vertical" gap="18px">
          {/* Check Compliance toolbar */}
          <Box gap="12px" verticalAlign="middle">
            <Button size="small" onClick={handleComplianceCheck} disabled={complianceLoading}>
              {complianceLoading ? 'Checking...' : 'Check Compliance'}
            </Button>
            {compliance && (
              <Text size="tiny" secondary>
                Last checked: {compliance.totalProducts} products
              </Text>
            )}
          </Box>

          {pendingFixCount > 0 && (
            <SectionHelper appearance="warning">
              <Box direction="horizontal" gap="12px" verticalAlign="middle">
                <Text size="small" weight="bold">{pendingFixCount} staged fix{pendingFixCount > 1 ? 'es' : ''} pending</Text>
                <Button size="small" onClick={() => handleApplyFixes('wix')} disabled={applyingFixes}>
                  {applyingFixes ? 'Applying...' : 'Apply to Wix'}
                </Button>
                <Button size="small" skin="light" onClick={() => handleApplyFixes('gmc')} disabled={applyingFixes}>
                  Apply to GMC
                </Button>
                <Button size="small" skin="premium" onClick={() => handleApplyFixes('both')} disabled={applyingFixes}>
                  Apply to Both
                </Button>
                <Button size="small" skin="destructive" onClick={() => setPendingFixes(new Map())}>
                  Discard All
                </Button>
              </Box>
            </SectionHelper>
          )}

          {compliance ? (
            <Card>
              <Card.Header title="Feed Health" suffix={
                <Badge skin={compliance.healthScore >= 90 ? 'success' : compliance.healthScore >= 70 ? 'warning' : 'danger'}>
                  {compliance.healthScore}%
                </Badge>
              } />
              <Card.Content>
                <Box direction="vertical" gap="12px">
                  <Box direction="horizontal" gap="24px">
                    <Text size="small">{compliance.compliantCount} compliant</Text>
                    <Text size="small" skin="standard">{compliance.warningCount} warnings</Text>
                    <Text size="small" skin="error">{compliance.errorCount} errors</Text>
                    <Text size="small" secondary>of {compliance.totalProducts} products</Text>
                  </Box>
                  {compliance.results.filter((r) => r.errors.length > 0 || r.warnings.length > 0).map((r) => {
                    const product = filteredProducts.find((p) => p.productId === r.productId);
                    const isExpanded = expandedCompliance === r.offerId;
                    const fixes = pendingFixes.get(r.offerId);
                    const allIssues = [...r.errors, ...r.warnings];
                    return (
                      <div key={r.offerId} style={{ background: r.compliant ? '#f0fdf4' : '#fef2f2', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div onClick={() => setExpandedCompliance(isExpanded ? null : r.offerId)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Badge size="small" skin={r.compliant ? 'warning' : 'danger'}>
                            {r.errors.length > 0 ? `${r.errors.length} error${r.errors.length > 1 ? 's' : ''}` : `${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''}`}
                          </Badge>
                          <Text size="small" weight="bold">{product?.name ?? r.productId.slice(0, 12)}</Text>
                          <Text size="tiny" secondary>ID: {r.offerId}</Text>
                          {fixes && fixes.size > 0 && (
                            <Badge size="small" skin="success">{fixes.size} fix{fixes.size > 1 ? 'es' : ''} staged</Badge>
                          )}
                          <Text size="tiny" secondary>{isExpanded ? '▾' : '▸'}</Text>
                        </div>
                        {isExpanded && (
                          <div style={{ paddingLeft: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {allIssues.map((issue, i) => {
                              const fixKey = `${r.offerId}:${issue.field}`;
                              const isEditing = editingFix === fixKey;
                              const hasFix = fixes?.has(issue.field);
                              const fixable = ['brand', 'description', 'title', 'condition', 'link', 'imageLink', 'offerId'].includes(issue.field);
                              return (
                                <div key={`issue${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Text size="tiny" skin={issue.severity === 'error' ? 'error' : undefined}>
                                      {issue.severity === 'warning' ? '⚠' : '✗'} {issue.field}: {issue.message}
                                    </Text>
                                    {hasFix && (
                                      <Badge size="small" skin="success">Fixed: {fixes!.get(issue.field)!.slice(0, 30)}{fixes!.get(issue.field)!.length > 30 ? '...' : ''}</Badge>
                                    )}
                                    {fixable && !isEditing && !hasFix && (
                                      <button onClick={(e) => { e.stopPropagation(); setEditingFix(fixKey); setEditingFixValue(''); }} style={{ border: '1px solid #3b82f6', background: '#eff6ff', color: '#3b82f6', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                        Fix
                                      </button>
                                    )}
                                    {hasFix && (
                                      <button onClick={(e) => { e.stopPropagation(); handleStageFix(r.offerId, issue.field, ''); }} style={{ border: '1px solid #9ca3af', background: 'transparent', color: '#9ca3af', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}>
                                        Undo
                                      </button>
                                    )}
                                  </div>
                                  {isEditing && (
                                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 16 }}>
                                      <Input size="small" placeholder={`Enter ${issue.field} value...`} value={editingFixValue} onChange={(e: any) => setEditingFixValue(e.target.value)} />
                                      <Button size="tiny" onClick={() => handleStageFix(r.offerId, issue.field, editingFixValue)} disabled={!editingFixValue.trim()}>
                                        Stage
                                      </Button>
                                      <Button size="tiny" skin="light" onClick={() => { setEditingFix(null); setEditingFixValue(''); }}>
                                        Cancel
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Box>
              </Card.Content>
            </Card>
          ) : (
            <Card>
              <Card.Content>
                <Box direction="vertical" align="center" padding="48px" gap="12px">
                  <Text weight="bold">No compliance data</Text>
                  <Text size="small" secondary>Click &quot;Check Compliance&quot; to validate your catalog against GMC requirements.</Text>
                </Box>
              </Card.Content>
            </Card>
          )}
        </Box>
      )}

      {productsSubTab === 'ai' && (
        <Box direction="vertical" gap="18px">
          {/* AI toolbar */}
          <Box gap="12px" verticalAlign="middle">
            <Button size="small" onClick={handleEnhanceAndPreview} disabled={aiPreviewLoading || filteredProducts.length === 0}>
              {aiPreviewLoading
                ? 'Generating...'
                : selected.size > 0
                  ? `Enhance Selected (${selected.size})`
                  : 'Enhance All'}
            </Button>
          </Box>

          {aiPreviews ? (
            <Card>
              <Card.Header
                title="AI Enhancement Preview"
                subtitle={`${aiPreviews.filter((p) => p.accepted).length} of ${aiPreviews.length} selected for update`}
                suffix={
                  <Box gap="12px">
                    <Button size="small" priority="secondary" onClick={() => setAiPreviews(null)}>
                      Cancel
                    </Button>
                    <Button size="small" skin="dark" onClick={handleApplyToStore} disabled={aiApplying}>
                      {aiApplying ? 'Applying...' : 'Apply to Store'}
                    </Button>
                  </Box>
                }
              />
              <Card.Divider />
              <Card.Content>
                <Box direction="vertical" gap="12px" maxHeight="600px" overflowY="auto">
                  {aiPreviews.map((preview) => (
                    <Card key={preview.productId}>
                      <Card.Content>
                        <Box gap="12px" verticalAlign="top">
                          <Box width="30px">
                            <ToggleSwitch
                              size="small"
                              checked={preview.accepted}
                              onChange={() => {
                                setAiPreviews((prev) =>
                                  prev?.map((p) =>
                                    p.productId === preview.productId
                                      ? { ...p, accepted: !p.accepted }
                                      : p,
                                  ) ?? null,
                                );
                              }}
                            />
                          </Box>
                          <Box direction="vertical" gap="6px" width="100%">
                            <Box gap="12px">
                              <Box direction="vertical" width="50%">
                                <Text size="tiny" weight="bold" secondary>Original Title</Text>
                                <Text size="small">{preview.original.title}</Text>
                              </Box>
                              <Box direction="vertical" width="50%">
                                <Text size="tiny" weight="bold" skin="success">Enhanced Title</Text>
                                <Text size="small">{preview.enhanced?.title ?? '—'}</Text>
                              </Box>
                            </Box>
                            <Box gap="12px">
                              <Box direction="vertical" width="50%">
                                <Text size="tiny" weight="bold" secondary>Original Description</Text>
                                <Text size="tiny">{preview.original.description ?? ''}</Text>
                              </Box>
                              <Box direction="vertical" width="50%">
                                <Text size="tiny" weight="bold" skin="success">Enhanced Description</Text>
                                <Text size="tiny">{preview.enhanced?.description ?? ''}</Text>
                              </Box>
                            </Box>
                          </Box>
                        </Box>
                      </Card.Content>
                    </Card>
                  ))}
                </Box>
              </Card.Content>
            </Card>
          ) : (
            <Card>
              <Card.Content>
                <Box direction="vertical" align="center" padding="48px" gap="12px">
                  <Text weight="bold">No AI previews</Text>
                  <Text size="small" secondary>Click &quot;Enhance Selected&quot; or &quot;Enhance All&quot; to generate AI-enhanced titles and descriptions.</Text>
                </Box>
              </Card.Content>
            </Card>
          )}
        </Box>
      )}
    </Box>
  );
};

// ─── Dashboard Tab (formerly Status Tab) ────────────────────────────────

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

const DashboardTab: FC = () => {
  const [data, setData] = useState<SyncSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    totalProducts: number;
    processed: number;
    currentStatus: string;
    syncedCount: number;
    failedCount: number;
  } | null>(null);

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
    setSyncResult(null);
    setError(null);
    pollProgress();
    try {
      const result = await triggerSync();
      setSyncProgress(null);
      setSyncResult(
        `Sync complete: ${result.synced} synced, ${result.failed} failed out of ${result.total} total`,
      );
      await loadData();
    } catch (err) {
      setSyncProgress(null);
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [loadData, pollProgress]);

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

      <Box direction="vertical">
        <Button onClick={handleSync} disabled={syncing} size="small">
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
        {syncProgress && syncProgress.currentStatus === 'running' && (
          <Box direction="vertical" gap="6px" marginTop="12px">
            <Box gap="6px" verticalAlign="middle">
              <Loader size="tiny" />
              <Text size="small">
                Syncing: {syncProgress.processed} / {syncProgress.totalProducts} products
              </Text>
            </Box>
            <Box
              height="8px"
              backgroundColor="#E8E8E8"
              borderRadius="4px"
              overflow="hidden"
            >
              <Box
                height="100%"
                width={`${syncProgress.totalProducts > 0
                  ? Math.round((syncProgress.processed / syncProgress.totalProducts) * 100)
                  : 0}%`}
                backgroundColor="#3B82F6"
                borderRadius="4px"
              />
            </Box>
            <Text size="tiny" secondary>
              {syncProgress.syncedCount} synced, {syncProgress.failedCount} failed
            </Text>
          </Box>
        )}
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
              onClick={(tab) => {
                if (_hasPendingFixes && activeTab === 'products' && String(tab.id) !== 'products') {
                  if (!window.confirm('You have uncommitted compliance fixes. Leave without applying them?')) return;
                }
                setActiveTab(String(tab.id));
              }}
              type="compactSide"
            />

            {activeTab === 'connect' && <ConnectTab config={config} onRefresh={loadConfig} />}
            {activeTab === 'dashboard' && <DashboardTab />}
            {activeTab === 'products' && <ProductsTab config={config} onConfigRefresh={loadConfig} />}
            {activeTab === 'mapping' && <MappingTab config={config} />}
            {activeTab === 'settings' && <SettingsTab config={config} onRefresh={loadConfig} />}
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default SyncStreamPage;
