// src/extensions/dashboard/pages/sync-stream/DashboardTab.tsx
import { type FC } from 'react';
import { Box, Text, Button, Card, Loader, LinearProgressBar, Badge, SectionHelper } from '@wix/design-system';
import type { SyncEvent, TopIssue } from '../../../../backend/dataService';
import { UPGRADE_URL } from '../../../../lib/constants';

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

interface BillingStatus {
  plan: 'free' | 'pro';
  creditsRemaining: number;
  resetDate: string;
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
  billingStatus: BillingStatus | null;
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


export const DashboardTabNormal: FC<DashboardTabNormalProps> = ({
  stats,
  platformHealth,
  topIssues,
  recentEvents,
  syncing,
  onSyncNow,
  onCheckCompliance,
  onNavigateToFailed,
  billingStatus,
}) => {
  // Merge gmc + meta top issues, deduplicate by field+message, take top 6
  const allTopIssues = (() => {
    const map = new Map<string, TopIssue>();
    for (const issue of [...topIssues.gmc, ...topIssues.meta]) {
      const key = `${issue.field}||${issue.message}`;
      const existing = map.get(key);
      if (existing) {
        map.set(key, { ...existing, count: Math.max(existing.count, issue.count) });
      } else {
        map.set(key, { ...issue });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return b.count - a.count;
      })
      .slice(0, 6);
  })();

  return (
    <Box direction="vertical" gap="16px">
      {billingStatus && (
        <SectionHelper appearance={billingStatus.plan === 'pro' ? 'success' : 'standard'}>
          <Box verticalAlign="middle" gap="12px">
            <Text size="small" weight="bold">
              {billingStatus.plan === 'pro' ? 'Pro' : 'Free'}
            </Text>
            <Text size="small" style={{ flex: 1 }}>
              AI credits: {billingStatus.creditsRemaining} remaining · resets{' '}
              {new Date(billingStatus.resetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
            {billingStatus.plan === 'free' && (
              <Button size="tiny" skin="light" onClick={() => window.open(UPGRADE_URL, '_blank')}>
                Upgrade to Pro
              </Button>
            )}
          </Box>
        </SectionHelper>
      )}
      {/* Stat cards */}
      <Box gap="12px">
        {[
          { num: stats.total, label: 'Total Products', sub: 'in catalog', skin: undefined as 'standard' | 'error' | 'success' | 'premium' | 'disabled' | 'primary' | undefined, warningColor: false },
          { num: stats.synced, label: 'Synced', sub: 'to GMC + Meta', skin: 'success' as const, warningColor: false },
          { num: stats.failed, label: 'Failed', sub: 'need attention', skin: 'error' as const, warningColor: false },
          { num: stats.warnings, label: 'Warnings', sub: 'missing SKUs etc.', skin: undefined as undefined, warningColor: true },
        ].map(({ num, label, sub, skin, warningColor }) => (
          <Box key={label} style={{ flex: 1 }}>
            <Card>
              <Card.Content>
                <Box direction="vertical">
                  <Text size="medium" weight="bold" skin={skin} style={{ fontSize: 24, ...(warningColor ? { color: '#f5a623' } : {}) }}>{num}</Text>
                  <Text size="small" weight="bold">{label}</Text>
                  <Text size="tiny" secondary>{sub}</Text>
                </Box>
              </Card.Content>
            </Card>
          </Box>
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
              { label: 'Google Merchant Center', health: platformHealth.gmc },
              { label: 'Meta Catalog', health: platformHealth.meta },
            ].map(({ label, health }) => (
              <Box key={label} direction="vertical" gap="4px">
                <Box gap="8px" verticalAlign="middle">
                  <Text size="small" weight="bold" style={{ flex: 1 }}>{label}</Text>
                  {health.connected ? (
                    <Text size="small" weight="bold">{health.pct}%</Text>
                  ) : (
                    <Text size="tiny" secondary>Not connected</Text>
                  )}
                </Box>
                {health.connected && (
                  <>
                    <LinearProgressBar
                      value={health.pct}
                      skin={health.errors === 0 ? 'success' : 'warning'}
                    />
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
          {syncing ? <Loader size="tiny" /> : 'Sync to Channels'}
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
                {recentEvents.map((event, i) => (
                  <Box
                    key={event.id ?? event.createdAt ?? i}
                    gap="8px"
                    verticalAlign="middle"
                    style={{ padding: '7px 0', borderBottom: '1px solid #f7f9fb' }}
                  >
                    <Badge
                      size="tiny"
                      skin={
                        event.severity === 'success' ? 'success' :
                        event.severity === 'error' ? 'danger' :
                        event.severity === 'warning' ? 'warning' : 'standard'
                      }
                    >
                      {event.severity}
                    </Badge>
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
                    <Badge size="tiny" skin={issue.severity === 'error' ? 'danger' : 'warning'}>
                      {issue.severity === 'error' ? 'Error' : 'Warning'}
                    </Badge>
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
