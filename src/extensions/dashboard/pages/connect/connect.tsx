import { type FC, useState, useEffect, useCallback } from 'react';
import {
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

async function callInitiateGmcOAuth(): Promise<string> {
  const response = await fetch('/api/gmc-oauth-init?instanceId=default');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.authUrl;
}

async function callGetAppConfig(): Promise<{
  gmcConnected: boolean;
  metaConnected: boolean;
} | null> {
  const response = await fetch('/api/app-config?instanceId=default');
  if (!response.ok) return null;
  return response.json();
}

async function callGetBillingStatus(): Promise<{ plan: 'free' | 'pro' } | null> {
  const response = await fetch('/api/billing-status?instanceId=default');
  if (!response.ok) return null;
  return response.json();
}

const ConnectPage: FC = () => {
  const [gmcConnected, setGmcConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<'free' | 'pro'>('free');
  const [metaConnected, setMetaConnected] = useState(false);

  useEffect(() => {
    Promise.all([callGetAppConfig(), callGetBillingStatus()])
      .then(([config, billing]) => {
        if (config) {
          setGmcConnected(config.gmcConnected);
          setMetaConnected(config.metaConnected ?? false);
        }
        if (billing) {
          setPlan(billing.plan);
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

            {plan === 'pro' ? (
              <Card>
                <Card.Header
                  title="Meta Product Catalog"
                  subtitle={
                    metaConnected
                      ? 'Connected'
                      : 'Connect to sync products to Meta Shopping'
                  }
                  suffix={
                    metaConnected ? (
                      <Text size="small" skin="success" weight="bold">
                        Connected
                      </Text>
                    ) : (
                      <Button size="small" disabled>
                        Connect
                      </Button>
                    )
                  }
                />
              </Card>
            ) : (
              <Card>
                <Card.Header
                  title="Meta Product Catalog"
                  subtitle="Available on Pro plan"
                  suffix={
                    <Button
                      size="small"
                      skin="light"
                      onClick={() => window.open('https://manage.wix.com/app-market', '_blank')}
                    >
                      Upgrade to Pro
                    </Button>
                  }
                />
              </Card>
            )}
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default ConnectPage;
