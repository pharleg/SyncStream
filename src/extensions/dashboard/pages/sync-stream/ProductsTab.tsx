// src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
import { type FC, type SyntheticEvent, useState, useMemo, useEffect } from 'react';
import { Box, Text, Input, Button, Loader, SegmentedToggle, SectionHelper } from '@wix/design-system';
import { UPGRADE_URL } from '../../../../lib/constants';
import { ProductRow, type ProductRowData, type ApplyFixPayload } from './ProductRow';

interface BillingStatus {
  plan: 'free' | 'pro';
  creditsRemaining: number;
  resetDate: string;
}

interface ProductsTabProps {
  products: ProductRowData[];
  loading: boolean;
  config: { gmcConnected: boolean; metaConnected: boolean } | null;
  onSyncNow: () => Promise<void>;
  onCheckCompliance: () => Promise<void>;
  onRefreshFromWix: () => Promise<void>;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
  onPlatformChange?: (productId: string, platforms: ('gmc' | 'meta')[] | null) => Promise<void>;
  onBulkPlatformChange?: (productIds: string[], platforms: ('gmc' | 'meta')[] | null) => Promise<void>;
  initialFilter?: 'all' | 'failed' | 'warnings' | 'synced';
  billingStatus?: BillingStatus | null;
}

type FilterTab = 'all' | 'failed' | 'warnings' | 'synced';

export const ProductsTab: FC<ProductsTabProps> = ({
  products,
  loading,
  config,
  onSyncNow,
  onCheckCompliance,
  onRefreshFromWix,
  onApplyFix,
  onToggleAI,
  onEnhanceNow,
  onPlatformChange,
  onBulkPlatformChange,
  initialFilter = 'all',
  billingStatus,
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>(initialFilter);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const syncBlocked = billingStatus?.plan === 'free' && products.length > 50;

  // Reset to initialFilter when it changes (e.g. navigated from dashboard "Fix Issues")
  useEffect(() => { setActiveFilter(initialFilter); }, [initialFilter]);

  const counts = useMemo(() => ({
    all: products.length,
    failed: products.filter((p) => p.gmcStatus === 'error' || p.metaStatus === 'error').length,
    warnings: products.filter((p) =>
      (p.gmcStatus === 'warning' || p.metaStatus === 'warning') &&
      p.gmcStatus !== 'error' && p.metaStatus !== 'error'
    ).length,
    synced: products.filter((p) => p.gmcStatus === 'synced' && p.metaStatus !== 'error').length,
  }), [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (activeFilter === 'failed') {
      list = list.filter((p) => p.gmcStatus === 'error' || p.metaStatus === 'error');
    } else if (activeFilter === 'warnings') {
      list = list.filter((p) =>
        (p.gmcStatus === 'warning' || p.metaStatus === 'warning') &&
        p.gmcStatus !== 'error' && p.metaStatus !== 'error'
      );
    } else if (activeFilter === 'synced') {
      list = list.filter((p) => p.gmcStatus === 'synced' && p.metaStatus !== 'error');
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeFilter, search]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try { await onSyncNow(); } finally { setSyncing(false); }
  };

  const handleCheckCompliance = async () => {
    setChecking(true);
    try { await onCheckCompliance(); } finally { setChecking(false); }
  };

  const handleRefreshFromWix = async () => {
    setRefreshing(true);
    try { await onRefreshFromWix(); } finally { setRefreshing(false); }
  };

  const handleSelect = (productId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(productId); else next.delete(productId);
      return next;
    });
  };

  const handleSelectAll = (selected: boolean) => {
    setSelectedIds(selected ? new Set(filtered.map((p) => p.productId)) : new Set());
  };

  const handleBulkPlatform = async (platforms: ('gmc' | 'meta')[] | null) => {
    if (!onBulkPlatformChange || selectedIds.size === 0) return;
    await onBulkPlatformChange([...selectedIds], platforms);
    setSelectedIds(new Set());
  };

  if (loading) {
    return (
      <Box align="center" padding="60px">
        <Loader />
      </Box>
    );
  }

  return (
    <Box direction="vertical" gap="12px">
      {syncBlocked && (
        <SectionHelper
          skin="warning"
          title="Catalog limit reached"
          actionText="Upgrade to Pro"
          onAction={() => window.open(UPGRADE_URL, '_blank')}
        >
          Free plan supports up to 50 products. You have {products.length} — upgrade to resume sync.
        </SectionHelper>
      )}
      {/* Toolbar */}
      <Box gap="8px" verticalAlign="middle" style={{ flexWrap: 'wrap' }}>
        <SegmentedToggle
          selected={activeFilter}
          onClick={(_e: SyntheticEvent, value: string) => setActiveFilter(value as FilterTab)}
        >
          <SegmentedToggle.Button value="all">All ({counts.all})</SegmentedToggle.Button>
          <SegmentedToggle.Button value="failed">Failed ({counts.failed})</SegmentedToggle.Button>
          <SegmentedToggle.Button value="warnings">Warnings ({counts.warnings})</SegmentedToggle.Button>
          <SegmentedToggle.Button value="synced">Synced ({counts.synced})</SegmentedToggle.Button>
        </SegmentedToggle>
        <Box style={{ flex: 1, minWidth: 160 }}>
          <Input
            size="small"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Button size="small" skin="light" onClick={handleRefreshFromWix} disabled={refreshing}>
          {refreshing ? <Loader size="tiny" /> : 'Refresh from Wix'}
        </Button>
        <Button size="small" skin="light" onClick={handleCheckCompliance} disabled={checking}>
          {checking ? <Loader size="tiny" /> : 'Check Compliance'}
        </Button>
        <Button size="small" onClick={handleSyncNow} disabled={syncing || syncBlocked}>
          {syncing ? <Loader size="tiny" /> : 'Sync to Channels'}
        </Button>
      </Box>

      {/* Bulk action bar */}
      {onBulkPlatformChange && selectedIds.size > 0 && (
        <Box
          gap="8px"
          verticalAlign="middle"
          style={{ padding: '8px 14px', background: '#eef2ff', borderRadius: 6, flexWrap: 'wrap' }}
        >
          <Text size="small" weight="bold">{selectedIds.size} selected</Text>
          <Button size="small" skin="light" onClick={() => handleBulkPlatform(['gmc'])}>GMC Only</Button>
          <Button size="small" skin="light" onClick={() => handleBulkPlatform(null)}>All Platforms</Button>
          <Button size="small" skin="light" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </Box>
      )}

      {/* Table */}
      <Box
        direction="vertical"
        style={{ background: 'white', border: '1px solid #e8edf0', borderRadius: 8, overflow: 'hidden' }}
      >
        {/* Header */}
        <Box
          gap="8px"
          style={{
            padding: '8px 14px',
            background: '#f7f9fb',
            borderBottom: '1px solid #e8edf0',
            display: 'grid',
            gridTemplateColumns: onBulkPlatformChange ? '20px 36px 1fr 72px 72px 88px 64px' : '36px 1fr 72px 72px 88px 64px',
          }}
        >
          {onBulkPlatformChange && (
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((p) => selectedIds.has(p.productId))}
              onChange={(e) => handleSelectAll(e.target.checked)}
              style={{ cursor: 'pointer', width: 14, height: 14, alignSelf: 'center' }}
            />
          )}
          <span />
          <Text size="tiny" secondary weight="bold">Product</Text>
          <Text size="tiny" secondary weight="bold">
            {config?.gmcConnected ? 'GMC' : '—'}
          </Text>
          <Text size="tiny" secondary weight="bold">
            {config?.metaConnected ? 'Meta' : '—'}
          </Text>
          <Text size="tiny" secondary weight="bold">AI Enhance</Text>
          <span />
        </Box>

        {/* Rows */}
        {filtered.length === 0 ? (
          <Box align="center" padding="40px">
            <Text secondary>
              {products.length === 0
                ? 'No products yet. Pull products to get started.'
                : 'No products match this filter.'}
            </Text>
          </Box>
        ) : (
          filtered.map((product) => (
            <ProductRow
              key={product.productId}
              product={product}
              isExpanded={expandedId === product.productId}
              isSelected={selectedIds.has(product.productId)}
              onExpand={setExpandedId}
              onSelect={onBulkPlatformChange ? handleSelect : undefined}
              onApplyFix={onApplyFix}
              onToggleAI={onToggleAI}
              onEnhanceNow={onEnhanceNow}
              onPlatformChange={onPlatformChange}
            />
          ))
        )}
      </Box>
    </Box>
  );
};
