// src/extensions/dashboard/pages/sync-stream/ProductsTab.tsx
import { type FC, useState, useMemo, useEffect } from 'react';
import { Box, Text, Input, Button, Loader } from '@wix/design-system';
import { ProductRow, type ProductRowData, type ApplyFixPayload } from './ProductRow';

interface ProductsTabProps {
  products: ProductRowData[];
  loading: boolean;
  config: { gmcConnected: boolean; metaConnected: boolean } | null;
  onSyncNow: () => Promise<void>;
  onCheckCompliance: () => Promise<void>;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
  initialFilter?: 'all' | 'failed' | 'warnings' | 'synced';
}

type FilterTab = 'all' | 'failed' | 'warnings' | 'synced';

export const ProductsTab: FC<ProductsTabProps> = ({
  products,
  loading,
  config,
  onSyncNow,
  onCheckCompliance,
  onApplyFix,
  onToggleAI,
  onEnhanceNow,
  initialFilter = 'all',
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>(initialFilter);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);

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

  const filterTabStyle = (tab: FilterTab): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 100,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid',
    borderColor: activeFilter === tab
      ? (tab === 'failed' ? '#f5c6c6' : tab === 'warnings' ? '#f5d67a' : tab === 'synced' ? '#a5d6b0' : '#32536a')
      : '#dfe5eb',
    background: activeFilter === tab
      ? (tab === 'failed' ? '#fce8e8' : tab === 'warnings' ? '#fff8e1' : tab === 'synced' ? '#e8f5ee' : '#32536a')
      : 'white',
    color: activeFilter === tab
      ? (tab === 'failed' ? '#c62828' : tab === 'warnings' ? '#c17d00' : tab === 'synced' ? '#2e7d32' : 'white')
      : '#7a92a5',
  });

  if (loading) {
    return (
      <Box align="center" padding="60px">
        <Loader />
      </Box>
    );
  }

  return (
    <Box direction="vertical" gap="12px">
      {/* Toolbar */}
      <Box gap="8px" verticalAlign="middle" style={{ flexWrap: 'wrap' }}>
        <Box gap="6px">
          {(['all', 'failed', 'warnings', 'synced'] as FilterTab[]).map((tab) => (
            <span
              key={tab}
              style={filterTabStyle(tab)}
              onClick={() => setActiveFilter(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({counts[tab]})
            </span>
          ))}
        </Box>
        <Box style={{ flex: 1, minWidth: 160 }}>
          <Input
            size="small"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Button size="small" skin="light" onClick={handleCheckCompliance} disabled={checking}>
          {checking ? <Loader size="tiny" /> : '⟳ Check All'}
        </Button>
        <Button size="small" onClick={handleSyncNow} disabled={syncing}>
          {syncing ? <Loader size="tiny" /> : '⟳ Sync Now'}
        </Button>
      </Box>

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
            gridTemplateColumns: '36px 1fr 72px 72px 80px 36px',
          }}
        >
          <span />
          <Text size="tiny" secondary weight="bold">Product</Text>
          <Text size="tiny" secondary weight="bold">
            {config?.gmcConnected ? 'GMC' : '—'}
          </Text>
          <Text size="tiny" secondary weight="bold">
            {config?.metaConnected ? 'Meta' : '—'}
          </Text>
          <Text size="tiny" secondary weight="bold">AI</Text>
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
              onExpand={setExpandedId}
              onApplyFix={onApplyFix}
              onToggleAI={onToggleAI}
              onEnhanceNow={onEnhanceNow}
            />
          ))
        )}
      </Box>
    </Box>
  );
};
