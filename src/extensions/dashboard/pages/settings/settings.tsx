import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  FormField,
  Input,
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
  aiEnhancementEnabled: boolean;
  aiEnhancementStyle: string;
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
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedCount, setEnhancedCount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetchConfig().then(setConfig).catch(() => {}),
      fetch('/api/enhance?instanceId=default')
        .then((r) => (r.ok ? r.json() : { enhancedCount: 0 }))
        .then((data: { enhancedCount: number }) => setEnhancedCount(data.enhancedCount))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
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

  const handleToggleAiEnhancement = useCallback(async () => {
    if (!config) return;
    const newValue = !config.aiEnhancementEnabled;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateConfig({ aiEnhancementEnabled: newValue });
      setConfig((prev) => prev ? { ...prev, aiEnhancementEnabled: newValue } : prev);
      setSuccess(newValue ? 'AI enhancement enabled.' : 'AI enhancement disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleAiStyleChange = useCallback(async (value: string) => {
    if (!config) return;
    setConfig((prev) => prev ? { ...prev, aiEnhancementStyle: value } : prev);
  }, [config]);

  const handleAiStyleBlur = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await updateConfig({ aiEnhancementStyle: config.aiEnhancementStyle });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save style');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleEnhanceAll = useCallback(async () => {
    setEnhancing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'default' }),
      });
      if (!response.ok) throw new Error('Enhancement failed');
      const result = await response.json();
      setEnhancedCount(result.enhancedCount ?? enhancedCount);
      setSuccess(`AI enhancement complete: ${result.enhanced ?? 0} descriptions enhanced.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed');
    } finally {
      setEnhancing(false);
    }
  }, [enhancedCount]);

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
                title="AI Description Enhancement"
                subtitle="Use Claude AI to optimize product descriptions for search engines"
              />
              <Card.Divider />
              <Card.Content>
                <Box direction="vertical" gap="18px">
                  <Box verticalAlign="middle" gap="12px">
                    <ToggleSwitch
                      checked={config?.aiEnhancementEnabled ?? false}
                      onChange={handleToggleAiEnhancement}
                      disabled={saving}
                    />
                    <Text size="small">
                      {config?.aiEnhancementEnabled ? 'Enabled' : 'Disabled'}
                    </Text>
                  </Box>
                  <FormField label="Style / Tone (optional)">
                    <Input
                      value={config?.aiEnhancementStyle ?? ''}
                      onChange={(e) => handleAiStyleChange(e.target.value)}
                      onBlur={handleAiStyleBlur}
                      placeholder="e.g. professional and concise"
                      disabled={!config?.aiEnhancementEnabled}
                    />
                  </FormField>
                  <Box verticalAlign="middle" gap="12px">
                    <Button
                      onClick={handleEnhanceAll}
                      disabled={enhancing || !config?.aiEnhancementEnabled}
                      size="small"
                    >
                      {enhancing ? 'Enhancing...' : 'Enhance All Descriptions'}
                    </Button>
                    <Text size="tiny" secondary>
                      {enhancedCount > 0
                        ? `${enhancedCount} product${enhancedCount === 1 ? '' : 's'} enhanced`
                        : 'No products enhanced yet'}
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
