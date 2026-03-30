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

// Derive the app's base URL for API calls
const BASE_URL = typeof import.meta.url !== 'undefined'
  ? new URL(import.meta.url).origin
  : '';

function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return httpClient.fetchWithAuth(`${BASE_URL}${path}`, init);
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

// ─── Connect Tab ─────────────────────────────────────────────────────────

const ConnectTab: FC<{ config: AppConfigData | null }> = ({ config }) => {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnectGmc = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const authUrl = await callInitiateGmcOAuth();
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
      setConnecting(false);
    }
  }, []);

  return (
    <Box direction="vertical" gap="24px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}

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
              <Button size="small" onClick={handleConnectGmc} disabled={connecting}>
                {connecting ? 'Connecting...' : 'Connect'}
              </Button>
            )
          }
        />
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

// ─── Mapping Tab ─────────────────────────────────────────────────────────

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

const MappingTab: FC<{ config: AppConfigData | null }> = ({ config }) => {
  const [mappings, setMappings] = useState<FieldMappings>(config?.fieldMappings ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateMapping = useCallback(
    (key: string, update: Partial<FieldMapping>) => {
      setMappings((prev) => ({
        ...prev,
        [key]: { ...prev[key], ...update } as FieldMapping,
      }));
      setSuccess(false);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await saveAppConfig({ fieldMappings: mappings });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [mappings]);

  return (
    <Box direction="vertical" gap="18px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">Mappings saved successfully.</SectionHelper>}

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
                        updateMapping(field.key, {
                          type: option.id as 'default' | 'customField',
                        })
                      }
                    />
                  </FormField>
                </Box>
                <Box>
                  <FormField
                    label={mapping.type === 'customField' ? 'Wix Field Key' : 'Default Value'}
                  >
                    <Input
                      size="small"
                      placeholder={field.placeholder}
                      value={
                        mapping.type === 'customField'
                          ? mapping.wixField ?? ''
                          : mapping.defaultValue ?? ''
                      }
                      onChange={(e) =>
                        updateMapping(field.key, {
                          ...(mapping.type === 'customField'
                            ? { wixField: e.target.value }
                            : { defaultValue: e.target.value }),
                        })
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
              onClick={(tab) => setActiveTab(String(tab.id))}
              type="compactSide"
            />

            {activeTab === 'connect' && <ConnectTab config={config} />}
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
