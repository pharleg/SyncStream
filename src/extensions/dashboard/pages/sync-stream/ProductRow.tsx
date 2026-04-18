// src/extensions/dashboard/pages/sync-stream/ProductRow.tsx
import { type FC, useState } from 'react';
import { Box, Text, Button, Input, FormField, ToggleSwitch, Loader } from '@wix/design-system';

export interface ProductIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ProductRowData {
  productId: string;
  name: string;
  imageUrl?: string;
  sku?: string;
  variantCount: number;
  price?: string;
  availability?: string;
  brand?: string;
  description?: string;
  gmcStatus: 'synced' | 'error' | 'warning' | 'pending' | null;
  metaStatus: 'synced' | 'error' | 'warning' | 'pending' | null;
  gmcIssues: ProductIssue[];
  metaIssues: ProductIssue[];
  aiEnabled: boolean;
  enhancedTitle?: string | null;
  enhancedDescription?: string | null;
  lastEnhancedAt?: string | null;
}

export interface ApplyFixPayload {
  productId: string;
  fixes: Record<string, string>;
  target: 'wix' | 'gmc' | 'both';
}

interface ProductRowProps {
  product: ProductRowData;
  isExpanded: boolean;
  onExpand: (productId: string | null) => void;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
}

const FIXABLE_FIELDS = ['brand', 'description', 'title', 'condition', 'link', 'imageLink', 'offerId'];

function statusColor(status: ProductRowData['gmcStatus']): string {
  switch (status) {
    case 'synced': return '#2e7d32';
    case 'error': return '#c62828';
    case 'warning': return '#c17d00';
    default: return '#7a92a5';
  }
}

function statusLabel(status: ProductRowData['gmcStatus']): string {
  switch (status) {
    case 'synced': return '✓ Synced';
    case 'error': return '✕ Failed';
    case 'warning': return '⚠ Warning';
    case 'pending': return '○ Pending';
    default: return '— N/A';
  }
}

function rowBackground(product: ProductRowData): string {
  if (product.gmcStatus === 'error' || product.metaStatus === 'error') return '#fffbfb';
  if (product.gmcStatus === 'warning' || product.metaStatus === 'warning') return '#fffdf5';
  return 'transparent';
}

const ExpandedPanel: FC<{
  product: ProductRowData;
  onApplyFix: (payload: ApplyFixPayload) => Promise<void>;
  onToggleAI: (productId: string, enabled: boolean) => Promise<void>;
  onEnhanceNow: (productId: string) => Promise<void>;
}> = ({ product, onApplyFix, onToggleAI, onEnhanceNow }) => {
  const allIssues = [...product.gmcIssues, ...product.metaIssues];
  const fixableIssues = allIssues.filter((i) => FIXABLE_FIELDS.includes(i.field));
  const uniqueFixableFields = [...new Set(fixableIssues.map((i) => i.field))];

  const initialValues: Record<string, string> = {};
  for (const field of uniqueFixableFields) {
    if (field === 'brand') initialValues[field] = product.brand ?? '';
    else if (field === 'description') initialValues[field] = product.description ?? '';
    else if (field === 'title') initialValues[field] = product.name;
    else if (field === 'imageLink') initialValues[field] = product.imageUrl ?? '';
    else if (field === 'offerId') initialValues[field] = product.sku ?? '';
    else initialValues[field] = '';
  }

  const [fixValues, setFixValues] = useState<Record<string, string>>(initialValues);
  const [applying, setApplying] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const handleApply = async (target: 'wix' | 'gmc' | 'both') => {
    setApplying(true);
    try {
      await onApplyFix({ productId: product.productId, fixes: fixValues, target });
    } finally {
      setApplying(false);
    }
  };

  const handleEnhance = async () => {
    setEnhancing(true);
    try {
      await onEnhanceNow(product.productId);
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <Box gap="24px" style={{ background: '#f7f9fb', borderTop: '1px solid #e8edf0', padding: '14px 14px 14px 58px' }}>
      {/* Column 1: Fix inputs */}
      <Box direction="vertical" style={{ flex: 1 }} gap="8px">
        <Text size="small" weight="bold">Fix Issues</Text>
        {uniqueFixableFields.length === 0 && (
          <Text size="small" secondary>No directly fixable fields.</Text>
        )}
        {uniqueFixableFields.map((field) => (
          <FormField key={field} label={field.charAt(0).toUpperCase() + field.slice(1)}>
            <Input
              size="small"
              value={fixValues[field] ?? ''}
              onChange={(e) => setFixValues((v) => ({ ...v, [field]: e.target.value }))}
            />
          </FormField>
        ))}
        {uniqueFixableFields.length > 0 && (
          <Box gap="8px" marginTop="4px">
            <Button size="small" skin="light" onClick={() => handleApply('wix')} disabled={applying}>
              Apply to Wix
            </Button>
            <Button size="small" skin="light" onClick={() => handleApply('gmc')} disabled={applying}>
              Apply to GMC
            </Button>
            <Button size="small" onClick={() => handleApply('both')} disabled={applying}>
              {applying ? <Loader size="tiny" /> : 'Apply Both'}
            </Button>
          </Box>
        )}
      </Box>

      {/* Column 2: Current feed values */}
      <Box direction="vertical" style={{ flex: 1 }} gap="4px">
        <Text size="small" weight="bold">Current Feed Values</Text>
        {[
          ['Title', product.name],
          ['Price', product.price ?? '—'],
          ['Availability', product.availability ?? '—'],
          ['Brand', product.brand ?? '—'],
        ].map(([label, value]) => (
          <Box key={label} direction="vertical">
            <Text size="tiny" secondary>{label}</Text>
            <Text size="small">{value}</Text>
          </Box>
        ))}
        {product.imageUrl && (
          <Box direction="vertical" marginTop="4px">
            <Text size="tiny" secondary>Image</Text>
            <img
              src={product.imageUrl}
              alt={product.name}
              style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, marginTop: 4, display: 'block' }}
            />
          </Box>
        )}
      </Box>

      {/* Column 3: SyncStream AI */}
      <Box direction="vertical" style={{ flex: 1 }} gap="8px">
        <Text size="small" weight="bold">SyncStream AI</Text>
        <Box gap="8px" verticalAlign="middle">
          <ToggleSwitch
            size="small"
            checked={product.aiEnabled}
            onChange={(e) => onToggleAI(product.productId, e.target.checked).catch(() => {})}
          />
          <Text size="small">{product.aiEnabled ? 'Auto-enhance on sync' : 'Enhancement off'}</Text>
        </Box>
        {product.lastEnhancedAt ? (
          <Text size="tiny" secondary>
            Last enhanced: {new Date(product.lastEnhancedAt).toLocaleDateString()}
          </Text>
        ) : (
          <Text size="tiny" secondary>Not enhanced yet</Text>
        )}
        <Button size="small" skin="light" onClick={handleEnhance} disabled={enhancing}>
          {enhancing ? <Loader size="tiny" /> : '✦ Enhance This Product'}
        </Button>
      </Box>
    </Box>
  );
};

export const ProductRow: FC<ProductRowProps> = ({
  product,
  isExpanded,
  onExpand,
  onApplyFix,
  onToggleAI,
  onEnhanceNow,
}) => {
  const allIssues = [...product.gmcIssues, ...product.metaIssues];
  const hasErrors = allIssues.some((i) => i.severity === 'error');
  const hasWarnings = allIssues.some((i) => i.severity === 'warning');

  return (
    <Box direction="vertical">
      {/* Main row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid #f0f2f5',
          background: rowBackground(product),
          cursor: 'pointer',
        }}
        onClick={() => onExpand(isExpanded ? null : product.productId)}
      >
        {/* Thumbnail */}
        <Box align="center" verticalAlign="middle" style={{ width: 32, height: 32, borderRadius: 4, flexShrink: 0, overflow: 'hidden', background: '#e8edf0' }}>
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} style={{ width: 32, height: 32, objectFit: 'cover', display: 'block' }} />
          ) : (
            <Text size="tiny" secondary>—</Text>
          )}
        </Box>

        {/* Product info + issues */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="small" weight="bold">{product.name}</Text>
          <Text size="tiny" secondary>
            {product.sku ? `SKU: ${product.sku}` : 'No SKU'} · {product.variantCount} variant{product.variantCount !== 1 ? 's' : ''}
          </Text>
          {allIssues.length > 0 && (
            <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {allIssues.map((issue) => (
                <Text
                  key={`${issue.field}-${issue.severity}-${issue.message}`}
                  size="tiny"
                  style={{ color: issue.severity === 'error' ? '#c62828' : '#c17d00' }}
                >
                  {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                </Text>
              ))}
            </div>
          )}
        </div>

        {/* GMC status */}
        <Box style={{ width: 72, flexShrink: 0 }} verticalAlign="top" paddingTop="2px">
          <Text size="tiny" weight="bold" style={{ color: statusColor(product.gmcStatus) }}>
            {statusLabel(product.gmcStatus)}
          </Text>
        </Box>

        {/* Meta status */}
        <Box style={{ width: 72, flexShrink: 0 }} verticalAlign="top" paddingTop="2px">
          <Text size="tiny" weight="bold" style={{ color: statusColor(product.metaStatus) }}>
            {statusLabel(product.metaStatus)}
          </Text>
        </Box>

        {/* AI toggle */}
        <Box gap="6px" verticalAlign="middle" style={{ width: 80, flexShrink: 0 }} paddingTop="2px">
          <ToggleSwitch
            size="small"
            checked={product.aiEnabled}
            onChange={(e) => {
              e.stopPropagation();
              onToggleAI(product.productId, e.target.checked).catch(() => {});
            }}
          />
          <Text size="tiny" secondary>{product.aiEnabled ? 'Enhanced' : 'Off'}</Text>
        </Box>

        {/* Action */}
        <Box style={{ width: 36, flexShrink: 0 }} verticalAlign="top" paddingTop="2px">
          <Text
            size="tiny"
            weight="bold"
            style={{ color: hasErrors ? '#c62828' : '#116dff', cursor: 'pointer' }}
          >
            {hasErrors || hasWarnings ? 'Fix' : '›'}
          </Text>
        </Box>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <ExpandedPanel
          key={product.productId}
          product={product}
          onApplyFix={onApplyFix}
          onToggleAI={onToggleAI}
          onEnhanceNow={onEnhanceNow}
        />
      )}
    </Box>
  );
};
