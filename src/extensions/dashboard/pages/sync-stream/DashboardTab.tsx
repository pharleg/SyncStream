// src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx
import { type FC } from 'react';
import { Box, Text, Button, Card, Loader } from '@wix/design-system';
import type { SyncEvent, TopIssue } from '../../../../backend/dataService';

export interface DashboardStats {
  total: number;
  synced: number;
  failed: number;
  warnings: number;
  lastFullSync: string | null;
}

export interface PlatformHealth {
  connected: boolean;
  total: number;
  synced: number;
  errors: number;
  pct: number;
}

interface DashboardTabNormalProps {
  stats: DashboardStats;
  platformHealth: { gmc: PlatformHealth; meta: PlatformHealth };
  topIssues: { gmc: TopIssue[]; meta: TopIssue[] };
  recentEvents: SyncEvent[];
  syncing: boolean;
  onSyncNow: () => void;
  onCheckCompliance: () => void;
  onNavigateToFailed: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function severityDotColor(severity: string): string {
  switch (severity) {
    case 'success': return '#3db37a';
    case 'error': return '#e53935';
    case 'warning': return '#f5a623';
    default: return '#116dff';
  }
}

export const DashboardTabNormal: FC<DashboardTabNormalProps> = ({
  stats,
  platformHealth,
  topIssues,
  recentEvents,
  syncing,
  onSyncNow,
  onCheckCompliance,
  onNavigateToFailed,
}) => {
  // Merge gmc + meta top issues, deduplicate by field+message, take top 6
  const allTopIssues = [...topIssues.gmc, ...topIssues.meta]
    .reduce<TopIssue[]>((acc, issue) => {
      const key = `${issue.field}||${issue.message}`;
      const existing = acc.find((i) => `${i.field}||${i.message}` === key);
      if (existing) {
        existing.count = Math.max(existing.count, issue.count);
      } else {
        acc.push({ ...issue });
      }
      return acc;
    }, [])
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, 6);

  return (
    <Box direction="vertical" gap="16px">
      {/* Stat cards */}
      <Box gap="12px">
        {[
          { num: stats.total, label: 'Total Products', sub: 'in catalog', color: '#32536a' },
          { num: stats.synced, label: 'Synced', sub: 'to GMC + Meta', color: '#3db37a' },
          { num: stats.failed, label: 'Failed', sub: 'need attention', color: '#e53935' },
          { num: stats.warnings, label: 'Warnings', sub: 'missing SKUs etc.', color: '#f5a623' },
        ].map(({ num, label, sub, color }) => (
          <Box key={label} style={{ flex: 1 }}><Card>
            <Card.Content>
              <Box direction="vertical">
                <Text size="medium" weight="bold" style={{ color, fontSize: 24 }}>{num}</Text>
                <Text size="small" weight="bold">{label}</Text>
                <Text size="tiny" secondary>{sub}</Text>
              </Box>
            </Card.Content>
          </Card></Box>
        ))}
      </Box>

      {/* Feed health */}
      <Card>
        <Card.Header
          title="Feed Health"
          suffix={
            stats.lastFullSync
              ? <Text size="tiny" secondary>Last synced {relativeTime(stats.lastFullSync)}</Text>
              : <Text size="tiny" secondary>Never synced</Text>
          }
        />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="10px">
            {[
              { label: 'Google Merchant Center', health: platformHealth.gmc, color: '#3db37a' },
              { label: 'Meta Catalog', health: platformHealth.meta, color: '#116dff' },
            ].map(({ label, health, color }) => (
              <Box key={label} direction="vertical" gap="4px">
                <Box gap="8px" verticalAlign="middle">
                  <Text size="small" weight="bold" style={{ flex: 1 }}>{label}</Text>
                  {health.connected ? (
                    <Text size="small" weight="bold" style={{ color }}>{health.pct}%</Text>
                  ) : (
                    <Text size="tiny" secondary>Not connected</Text>
                  )}
                </Box>
                {health.connected && (
                  <>
                    <Box style={{ height: 8, background: '#e8edf0', borderRadius: 4, overflow: 'hidden' }}>
                      <Box
                        style={{
                          height: '100%',
                          width: `${health.pct}%`,
                          background: color,
                          borderRadius: 4,
                        }}
                      />
                    </Box>
                    <Text size="tiny" secondary>
                      {health.synced} of {health.total} products passing · {health.errors} errors
                    </Text>
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Card.Content>
      </Card>

      {/* Action buttons */}
      <Box gap="8px">
        <Button onClick={onSyncNow} disabled={syncing}>
          {syncing ? <Loader size="tiny" /> : 'Sync Now'}
        </Button>
        {stats.failed > 0 && (
          <Button skin="light" onClick={onNavigateToFailed}>
            Fix Issues ({stats.failed})
          </Button>
        )}
        <Button skin="light" onClick={onCheckCompliance}>
          Check Compliance
        </Button>
      </Box>

      {/* Two-column: activity + top issues */}
      <Box gap="12px" style={{ alignItems: 'flex-start' }}>
        {/* Recent activity */}
        <Box style={{ flex: 2 }}><Card>
          <Card.Header title="Recent Activity" />
          <Card.Divider />
          <Card.Content>
            {recentEvents.length === 0 ? (
              <Text size="small" secondary>No activity yet.</Text>
            ) : (
              <Box direction="vertical" gap="0">
                {recentEvents.map((event) => (
                  <Box
                    key={event.id ?? event.createdAt}
                    gap="8px"
                    verticalAlign="middle"
                    style={{ padding: '7px 0', borderBottom: '1px solid #f7f9fb' }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: severityDotColor(event.severity),
                        flexShrink: 0,
                        display: 'inline-block',
                      }}
                    />
                    <Text size="small" style={{ flex: 1 }}>{event.message}</Text>
                    <Text size="tiny" secondary>
                      {event.createdAt ? relativeTime(event.createdAt) : ''}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
          </Card.Content>
        </Card></Box>

        {/* Top issues */}
        <Box style={{ flex: 1, minWidth: 240 }}><Card>
          <Card.Header title="Top Issues" />
          <Card.Divider />
          <Card.Content>
            {allTopIssues.length === 0 ? (
              <Box gap="6px" verticalAlign="middle">
                <Text size="small" style={{ color: '#3db37a' }}>✓</Text>
                <Text size="small">All products healthy</Text>
              </Box>
            ) : (
              <Box direction="vertical" gap="0">
                {allTopIssues.map((issue, i) => (
                  <Box
                    key={`${issue.field}-${issue.message}-${i}`}
                    gap="8px"
                    verticalAlign="middle"
                    style={{ padding: '6px 0', borderBottom: '1px solid #f7f9fb', justifyContent: 'space-between' }}
                  >
                    <Text size="small">
                      {issue.message} ({issue.count} product{issue.count !== 1 ? 's' : ''})
                    </Text>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: issue.severity === 'error' ? '#fce8e8' : '#fff8e1',
                        color: issue.severity === 'error' ? '#c62828' : '#c17d00',
                        flexShrink: 0,
                      }}
                    >
                      {issue.severity === 'error' ? 'Error' : 'Warning'}
                    </span>
                  </Box>
                ))}
              </Box>
            )}
          </Card.Content>
        </Card></Box>
      </Box>
    </Box>
  );
};
