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
  Loader,
  SectionHelper,
  Tabs,
  ToggleSwitch,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';

// ── Types ──

interface FieldMapping {
  type: 'customField' | 'default';
  wixField?: string;
  defaultValue?: string;
}

type FieldMappings = Record<string, FieldMapping>;

interface MappingField {
  key: string;
  label: string;
  description: string;
  placeholder: string;
}

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

// ── Constants ──

const MAPPING_FIELDS: MappingField[] = [
  { key: 'siteUrl', label: 'Site URL', description: 'Your store base URL (e.g. https://www.example.com)', placeholder: 'https://www.example.com' },
  { key: 'brand', label: 'Brand', description: 'Product brand name for GMC', placeholder: 'Your Brand Name' },
  { key: 'condition', label: 'Condition', description: 'Product condition (new, refurbished, used)', placeholder: 'new' },
  { key: 'gtin', label: 'GTIN / UPC', description: 'Global Trade Item Number — map to a Wix custom field if products have barcodes', placeholder: 'barcode' },
  { key: 'mpn', label: 'MPN', description: 'Manufacturer Part Number — map to a Wix custom field if available', placeholder: 'mpn' },
  { key: 'googleProductCategory', label: 'Google Product Category', description: 'Google taxonomy category (e.g. "Apparel & Accessories > Clothing")', placeholder: 'Apparel & Accessories > Clothing' },
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

const TAB_ITEMS = [
  { id: 'mapping', title: 'Field Mapping' },
  { id: 'rules', title: 'Rules' },
  { id: 'filters', title: 'Filters' },
];

// ── API helpers ──

async function fetchMappings(): Promise<FieldMappings> {
  const response = await fetch('/api/app-config?instanceId=default');
  if (!response.ok) return {};
  const config = await response.json();
  return config?.fieldMappings ?? {};
}

async function saveMappings(mappings: FieldMappings): Promise<void> {
  const response = await fetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', fieldMappings: mappings }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? 'Failed to save');
  }
}

async function fetchRules(): Promise<SyncRule[]> {
  const response = await fetch('/api/rules?instanceId=default');
  if (!response.ok) return [];
  return response.json();
}

async function apiSaveRule(rule: SyncRule): Promise<void> {
  const response = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!response.ok) throw new Error('Failed to save rule');
}

async function apiDeleteRule(id: string): Promise<void> {
  const response = await fetch(`/api/rules?id=${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete rule');
}

async function fetchFilters(): Promise<SyncFilter[]> {
  const response = await fetch('/api/filters?instanceId=default');
  if (!response.ok) return [];
  return response.json();
}

async function apiSaveFilter(filter: SyncFilter): Promise<void> {
  const response = await fetch('/api/filters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  if (!response.ok) throw new Error('Failed to save filter');
}

async function apiDeleteFilter(id: string): Promise<void> {
  const response = await fetch(`/api/filters?id=${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete filter');
}

// ── Rule expression builder helper ──

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

// ── Component ──

const MappingPage: FC = () => {
  const [activeTab, setActiveTab] = useState('mapping');
  const [mappings, setMappings] = useState<FieldMappings>({});
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [filters, setFilters] = useState<SyncFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New rule form state
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', platform: 'both', field: '', type: 'static' });
  const [exprState, setExprState] = useState({ staticValue: '', concatValue: '', calcField: '', calcOperator: '+', calcOperand: '' });

  // New filter form state
  const [showFilterForm, setShowFilterForm] = useState(false);
  const [newFilter, setNewFilter] = useState({ name: '', platform: 'both', field: '', operator: 'equals', value: '', conditionGroup: 'AND' });

  useEffect(() => {
    Promise.all([fetchMappings(), fetchRules(), fetchFilters()])
      .then(([m, r, f]) => { setMappings(m); setRules(r); setFilters(f); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateMapping = useCallback(
    (key: string, update: Partial<FieldMapping>) => {
      setMappings((prev) => ({ ...prev, [key]: { ...prev[key], ...update } as FieldMapping }));
      setSuccess(null);
    },
    [],
  );

  const handleSaveMappings = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      await saveMappings(mappings);
      setSuccess('Mappings saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }, [mappings]);

  const handleSaveRule = useCallback(async () => {
    setSaving(true); setError(null);
    try {
      const rule: SyncRule = {
        instanceId: 'default',
        name: newRule.name,
        platform: newRule.platform,
        field: newRule.field,
        type: newRule.type,
        expression: buildExpression(newRule.type, exprState),
        order: rules.length,
        enabled: true,
      };
      await apiSaveRule(rule);
      setRules(await fetchRules());
      setShowRuleForm(false);
      setNewRule({ name: '', platform: 'both', field: '', type: 'static' });
      setExprState({ staticValue: '', concatValue: '', calcField: '', calcOperator: '+', calcOperand: '' });
      setSuccess('Rule saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally { setSaving(false); }
  }, [newRule, exprState, rules.length]);

  const handleDeleteRule = useCallback(async (id: string) => {
    try {
      await apiDeleteRule(id);
      setRules(await fetchRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  }, []);

  const handleSaveFilter = useCallback(async () => {
    setSaving(true); setError(null);
    try {
      const filter: SyncFilter = {
        instanceId: 'default',
        name: newFilter.name,
        platform: newFilter.platform,
        field: newFilter.field,
        operator: newFilter.operator,
        value: newFilter.value,
        conditionGroup: newFilter.conditionGroup,
        order: filters.length,
        enabled: true,
      };
      await apiSaveFilter(filter);
      setFilters(await fetchFilters());
      setShowFilterForm(false);
      setNewFilter({ name: '', platform: 'both', field: '', operator: 'equals', value: '', conditionGroup: 'AND' });
      setSuccess('Filter saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save filter');
    } finally { setSaving(false); }
  }, [newFilter, filters.length]);

  const handleDeleteFilter = useCallback(async (id: string) => {
    try {
      await apiDeleteFilter(id);
      setFilters(await fetchFilters());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete filter');
    }
  }, []);

  if (loading) {
    return (
      <WixDesignSystemProvider features={{ newColorsBranding: true }}>
        <Page>
          <Page.Content>
            <Box align="center" padding="60px"><Loader /></Box>
          </Page.Content>
        </Page>
      </WixDesignSystemProvider>
    );
  }

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Field Mapping & Rules"
          subtitle="Configure field mappings, transformation rules, and product filters"
          actionsBar={
            activeTab === 'mapping' ? (
              <Button onClick={handleSaveMappings} disabled={saving}>
                {saving ? 'Saving...' : 'Save Mappings'}
              </Button>
            ) : undefined
          }
        />
        <Page.Content>
          <Box direction="vertical" gap="18px">
            {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
            {success && <SectionHelper appearance="success">{success}</SectionHelper>}

            <Tabs
              items={TAB_ITEMS}
              activeId={activeTab}
              onClick={(tab) => { setActiveTab(tab.id as string); setError(null); setSuccess(null); }}
            />

            {/* ── Field Mapping Tab ── */}
            {activeTab === 'mapping' && (
              <Box direction="vertical" gap="18px">
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
                                onSelect={(option) => updateMapping(field.key, { type: option.id as 'default' | 'customField' })}
                              />
                            </FormField>
                          </Box>
                          <Box>
                            <FormField label={mapping.type === 'customField' ? 'Wix Field Key' : 'Default Value'}>
                              <Input
                                size="small"
                                placeholder={field.placeholder}
                                value={mapping.type === 'customField' ? mapping.wixField ?? '' : mapping.defaultValue ?? ''}
                                onChange={(e) => updateMapping(field.key, mapping.type === 'customField' ? { wixField: e.target.value } : { defaultValue: e.target.value })}
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

            {/* ── Rules Tab ── */}
            {activeTab === 'rules' && (
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
                            await apiSaveRule({ ...rule, enabled: !rule.enabled });
                            setRules(await fetchRules());
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

            {/* ── Filters Tab ── */}
            {activeTab === 'filters' && (
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
                            await apiSaveFilter({ ...filter, enabled: !filter.enabled });
                            setFilters(await fetchFilters());
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
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default MappingPage;
