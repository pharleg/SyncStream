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
  const [applyError, setApplyError] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  // Local AI preview — mirrors persisted state but toggles description preview immediately
  const [aiPreview, setAiPreview] = useState(product.aiEnabled);

  const handleApply = async (target: 'wix' | 'gmc' | 'both', overrideFixes?: Record<string, string>) => {
    setApplying(true);
    setApplyError(null);
    try {
      await onApplyFix({ productId: product.productId, fixes: overrideFixes ?? fixValues, target });
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setApplying(false);
    }
  };

  const handleEnhance = async () => {
    setEnhancing(true);
    try {
      await onEnhanceNow(product.productId);
      setAiPreview(true);
    } finally {
      setEnhancing(false);
    }
  };

  const handleAiToggle = (checked: boolean) => {
    setAiPreview(checked);
    onToggleAI(product.productId, checked).catch(() => {});
  };

  const descriptionToShow = aiPreview && product.enhancedDescription
    ? product.enhancedDescription
    : (product.description ?? '');

  return (
    <Box direction="vertical" gap="8px" style={{ background: '#f7f9fb', borderTop: '1px solid #e8edf0', padding: '14px 14px 14px 58px' }}>
      {applyError && (
        <div style={{ color: '#c62828', fontSize: 12, padding: '6px 10px', background: '#fff5f5', borderRadius: 4, border: '1px solid #ffcdd2' }}>
          {applyError}
        </div>
      )}
      <Box gap="24px">
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
        <Box direction="vertical">
          <Text size="tiny" secondary>Description</Text>
          <Text size="small" style={{ whiteSpace: 'pre-wrap' }}>
            {product.description
              ? (product.description.length > 200 ? product.description.slice(0, 200) + '…' : product.description)
              : '—'}
          </Text>
        </Box>
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
            checked={aiPreview}
            onChange={(e) => handleAiToggle(e.target.checked)}
          />
          <Text size="small" weight="bold">
            {aiPreview ? '✦ AI-Enhanced Description' : 'Original Description'}
          </Text>
        </Box>
        {/* Description preview — switches with the toggle */}
        <div style={{
          background: aiPreview ? '#f0f5ff' : '#fff',
          border: `1px solid ${aiPreview ? '#c0d4ff' : '#e8edf0'}`,
          borderRadius: 4,
          padding: '8px 10px',
          fontSize: 12,
          lineHeight: 1.5,
          color: '#32536a',
          minHeight: 60,
          whiteSpace: 'pre-wrap',
        }}>
          {descriptionToShow || <span style={{ color: '#aaa', fontStyle: 'italic' }}>No description</span>}
        </div>
        {aiPreview && !product.enhancedDescription && (
          <Text size="tiny" secondary>No AI version yet — click Enhance to generate one.</Text>
        )}
        {product.lastEnhancedAt && (
          <Text size="tiny" secondary>
            Last enhanced: {new Date(product.lastEnhancedAt).toLocaleDateString()}
          </Text>
        )}
        <Button size="small" skin="light" onClick={handleEnhance} disabled={enhancing}>
          {enhancing ? <Loader size="tiny" /> : '✦ Enhance This Product'}
        </Button>
        {product.enhancedDescription && (
          <Button
            size="small"
            onClick={() => handleApply('wix', { description: product.enhancedDescription! })}
            disabled={applying}
          >
            Apply AI to Wix
          </Button>
        )}
      </Box>
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
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
        <Box gap="6px" verticalAlign="middle" style={{ width: 88, flexShrink: 0 }} paddingTop="2px">
          <ToggleSwitch
            size="small"
            checked={product.aiEnabled}
            onChange={(e) => {
              e.stopPropagation();
              onToggleAI(product.productId, e.target.checked).catch(() => {});
            }}
          />
          <Text size="tiny" secondary>{product.aiEnabled ? 'On' : 'Off'}</Text>
        </Box>

        {/* Action */}
        <Box style={{ width: 64, flexShrink: 0 }} verticalAlign="top" paddingTop="1px">
          {hasErrors || hasWarnings ? (
            <button
              onClick={(e) => { e.stopPropagation(); onExpand(isExpanded ? null : product.productId); }}
              style={{
                background: hasErrors ? '#c62828' : '#2e7d32',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '5px 12px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Fix
            </button>
          ) : (
            <Text size="small" secondary style={{ cursor: 'pointer', paddingTop: 2 }}>›</Text>
          )}
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
