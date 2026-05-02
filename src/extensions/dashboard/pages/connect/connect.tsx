import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Page,
  Text,
  Loader,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { httpClient } from '@wix/essentials';
import { META_OAUTH_ENABLED } from '../../../../lib/constants';

function connectFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, new URL(import.meta.url).origin).toString();
  return httpClient.fetchWithAuth(url, init);
}

async function callInitiateGmcOAuth(): Promise<string> {
  const response = await connectFetch('/api/gmc-oauth-init');
  if (!response.ok) {
    const text = await response.text();
    const msg = (() => { try { return (JSON.parse(text) as { error?: string }).error; } catch { return text; } })();
    throw new Error(msg ?? `OAuth init failed (${response.status})`);
  }
  const data = await response.json();
  return data.authUrl;
}

async function callGetAppConfig(): Promise<{
  gmcConnected: boolean;
  metaConnected: boolean;
} | null> {
  const response = await connectFetch('/api/app-config');
  if (!response.ok) return null;
  return response.json();
}

async function callCompleteGmcOAuth(): Promise<{ connected: boolean; error?: string }> {
  try {
    const response = await connectFetch('/api/gmc-complete-oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) return { connected: false, error: data.error ?? `HTTP ${response.status}` };
    return { connected: data.connected === true };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const ConnectPage: FC = () => {
  const [gmcConnected, setGmcConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaConnected, setMetaConnected] = useState(false);

  useEffect(() => {
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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleConnectGmc = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const authUrl = await callInitiateGmcOAuth();
      window.location.href = authUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start OAuth flow',
      );
      setConnecting(false);
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
        <Page.Header
          title="Connect"
          subtitle="Connect your product feed destinations"
        />
        <Page.Content>
          <Box direction="vertical" gap="24px">
            {error && (
              <SectionHelper appearance="danger">
                {error}
              </SectionHelper>
            )}

            <Card>
              <Card.Header
                title="Google Merchant Center"
                subtitle={
                  gmcConnected
                    ? 'Connected'
                    : 'Connect to sync products to Google Shopping'
                }
                suffix={
                  gmcConnected ? (
                    <Text size="small" skin="success" weight="bold">
                      Connected
                    </Text>
                  ) : (
                    <Button
                      size="small"
                      onClick={handleConnectGmc}
                      disabled={connecting}
                    >
                      {connecting ? 'Connecting...' : 'Connect'}
                    </Button>
                  )
                }
              />
            </Card>

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
                    <Badge size="tiny" skin="standard">COMING SOON</Badge>
                  )
                }
              />
            </Card>
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default ConnectPage;
