import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Page,
  Text,
  ToggleSwitch,
  Loader,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';

interface AppConfig {
  instanceId: string;
  gmcConnected: boolean;
  metaConnected: boolean;
  syncEnabled: boolean;
  lastFullSync: string | null;
}

async function fetchConfig(): Promise<AppConfig | null> {
  const response = await fetch('/api/app-config?instanceId=default');
  if (!response.ok) return null;
  return response.json();
}

async function updateConfig(updates: Partial<AppConfig>): Promise<void> {
  const response = await fetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', ...updates }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? 'Failed to save');
  }
}

async function triggerFullSync(): Promise<{ total: number; synced: number; failed: number }> {
  const response = await fetch('/api/sync-trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', platforms: ['gmc'] }),
  });
  if (!response.ok) throw new Error('Sync failed');
  return response.json();
}

const SettingsPage: FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggleSync = useCallback(async () => {
    if (!config) return;
    const newValue = !config.syncEnabled;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateConfig({ syncEnabled: newValue });
      setConfig((prev) => prev ? { ...prev, syncEnabled: newValue } : prev);
      setSuccess(newValue ? 'Sync enabled — products will sync automatically.' : 'Sync disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleFullSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await triggerFullSync();
      setSuccess(`Full sync complete: ${result.synced} synced, ${result.failed} failed out of ${result.total} total.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, []);

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
        <Page.Header title="Settings" subtitle="Manage your SyncStream configuration" />
        <Page.Content>
          <Box direction="vertical" gap="24px">
            {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
            {success && <SectionHelper appearance="success">{success}</SectionHelper>}

            <Card>
              <Card.Header title="Auto Sync" subtitle="Automatically sync products when they are created, updated, or deleted" />
              <Card.Divider />
              <Card.Content>
                <Box verticalAlign="middle" gap="12px">
                  <ToggleSwitch
                    checked={config?.syncEnabled ?? false}
                    onChange={handleToggleSync}
                    disabled={saving}
                  />
                  <Text size="small">
                    {config?.syncEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
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
                    <Text size="small" skin={config?.gmcConnected ? 'success' : 'error'}>
                      {config?.gmcConnected ? 'Connected' : 'Not Connected'}
                    </Text>
                  </Box>
                  <Box verticalAlign="middle" gap="12px">
                    <Text weight="bold" size="small">Meta Product Catalog:</Text>
                    <Text size="small" skin={config?.metaConnected ? 'success' : 'error'}>
                      {config?.metaConnected ? 'Connected' : 'Not Connected'}
                    </Text>
                  </Box>
                </Box>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header
                title="Manual Sync"
                subtitle={
                  config?.lastFullSync
                    ? `Last full sync: ${new Date(config.lastFullSync).toLocaleString()}`
                    : 'No full sync has been run yet'
                }
              />
              <Card.Divider />
              <Card.Content>
                <Button onClick={handleFullSync} disabled={syncing || !config?.gmcConnected}>
                  {syncing ? 'Syncing...' : 'Run Full Sync'}
                </Button>
              </Card.Content>
            </Card>
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default SettingsPage;
