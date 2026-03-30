import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Page,
  Text,
  Badge,
  Table,
  TableToolbar,
  Loader,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';

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

async function fetchSyncStatus(): Promise<SyncSummary> {
  const response = await fetch('/api/sync-status?instanceId=default');
  if (!response.ok) throw new Error('Failed to fetch sync status');
  return response.json();
}

async function triggerSync(): Promise<{ total: number; synced: number; failed: number }> {
  const response = await fetch('/api/sync-trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', platforms: ['gmc'] }),
  });
  if (!response.ok) throw new Error('Sync failed');
  return response.json();
}

const columns = [
  {
    title: 'Product ID',
    render: (row: SyncRecord) => (
      <Text size="small" secondary>
        {row.productId.slice(0, 8)}...
      </Text>
    ),
    width: '25%',
  },
  {
    title: 'Platform',
    render: (row: SyncRecord) => (
      <Badge size="small" skin="general">
        {row.platform.toUpperCase()}
      </Badge>
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
      <Text size="small">
        {new Date(row.lastSynced).toLocaleString()}
      </Text>
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

const StatusPage: FC = () => {
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
          title="Sync Status"
          subtitle="Monitor product sync across platforms"
          actionsBar={
            <Button onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          }
        />
        <Page.Content>
          <Box direction="vertical" gap="24px">
            {error && (
              <SectionHelper appearance="danger">{error}</SectionHelper>
            )}
            {syncResult && (
              <SectionHelper appearance="success">{syncResult}</SectionHelper>
            )}

            <Box gap="12px">
              <Card>
                <Card.Header
                  title={String(data?.totalSynced ?? 0)}
                  subtitle="Synced"
                />
              </Card>
              <Card>
                <Card.Header
                  title={String(data?.totalErrors ?? 0)}
                  subtitle="Errors"
                />
              </Card>
              <Card>
                <Card.Header
                  title={String(data?.totalPending ?? 0)}
                  subtitle="Pending"
                />
              </Card>
              <Card>
                <Card.Header
                  title={data?.lastFullSync ? new Date(data.lastFullSync).toLocaleDateString() : 'Never'}
                  subtitle="Last Full Sync"
                />
              </Card>
            </Box>

            <Card>
              <Table data={data?.records ?? []} columns={columns}>
                <TableToolbar>
                  <TableToolbar.Title>
                    Sync Records ({data?.records?.length ?? 0})
                  </TableToolbar.Title>
                </TableToolbar>
                <Table.Content />
              </Table>
            </Card>
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default StatusPage;
