import { type FC, type MouseEvent, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Dropdown,
  FormField,
  Input,
  InputArea,
  Text,
  Loader,
  SectionHelper,
} from '@wix/design-system';
import { httpClient } from '@wix/essentials';

// ── Types ──────────────────────────────────────────────────────────────────

interface IssueGroup {
  field: string;
  count: number;
  message: string;
}

interface AppConfigData {
  instanceId: string;
  fieldMappings: Record<string, { type: string; defaultValue?: string }>;
  [key: string]: unknown;
}

interface Phase1Step {
  field: 'brand' | 'condition';
  label: string;
  affectsCount: number;
  defaultValue: string;
}

interface Phase2ProductStep {
  productId: string;
  productName: string;
  productImage?: string;
  productPrice?: string;
  issues: Array<{ field: string; errorMessage: string; isImageField: boolean }>;
}

export interface FixWizardProps {
  issueGroups: IssueGroup[];
  config: AppConfigData;
  onComplete: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const GLOBAL_FIELDS = new Set<string>(['brand', 'condition']);
const IMAGE_FIELDS = new Set<string>(['imageLink', 'image_link']);

const FIELD_LABELS: Record<string, string> = {
  brand: 'Brand name',
  condition: 'Product condition',
  description: 'Product description',
  title: 'Product title',
  imageLink: 'Product image',
  link: 'Product link',
  offerId: 'Product SKU / ID',
};

const CONDITION_OPTIONS = [
  { id: 'new', value: 'New' },
  { id: 'refurbished', value: 'Refurbished' },
  { id: 'used', value: 'Used' },
];

// ── appFetch helper (mirrors sync-stream.tsx) ─────────────────────────────

async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = new URL(import.meta.url).origin;
  return httpClient.fetchWithAuth(`${baseUrl}${path}`, init);
}

// ── FixWizard ──────────────────────────────────────────────────────────────

export const FixWizard: FC<FixWizardProps> = ({ issueGroups, config, onComplete }) => {
  const [loadingCompliance, setLoadingCompliance] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase1Steps, setPhase1Steps] = useState<Phase1Step[]>([]);
  const [phase2Products, setPhase2Products] = useState<Phase2ProductStep[]>([]);

  const [phase, setPhase] = useState<1 | 2>(1);
  const [p1Idx, setP1Idx] = useState(0);
  const [p2ProdIdx, setP2ProdIdx] = useState(0);
  const [p2IssueIdx, setP2IssueIdx] = useState(0);

  const [inputValue, setInputValue] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Load compliance data on mount ─────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingCompliance(true);
        const res = await appFetch('/api/compliance-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId: 'default', platform: 'gmc' }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Derive Phase 1 steps from issueGroups (brand / condition only)
        const p1: Phase1Step[] = issueGroups
          .filter((g) => GLOBAL_FIELDS.has(g.field))
          .map((g) => ({
            field: g.field as 'brand' | 'condition',
            label: FIELD_LABELS[g.field] ?? g.field,
            affectsCount: g.count,
            defaultValue:
              g.field === 'condition'
                ? (config.fieldMappings?.condition?.defaultValue ?? 'new')
                : (config.fieldMappings?.brand?.defaultValue ?? ''),
          }));
        setPhase1Steps(p1);

        // Derive Phase 2 steps from compliance results (depth-first per product)
        const p2: Phase2ProductStep[] = (data.results ?? [])
          .filter((r: any) => !r.compliant || r.errors?.length > 0)
          .map((r: any) => {
            const errors: Array<{ field: string; message: string; severity: string }> = r.errors ?? [];
            const issues = errors
              .filter((e) => e.severity === 'error')
              .map((e) => ({
                field: e.field,
                errorMessage: e.message,
                isImageField: IMAGE_FIELDS.has(e.field),
              }));

            return {
              productId: r.productId,
              productName: r.offerId ?? r.productId,
              issues,
            };
          })
          .filter((p: Phase2ProductStep) => p.issues.length > 0);

        setPhase2Products(p2);

        // If no Phase 1 steps, start on Phase 2
        if (p1.length === 0) setPhase(2);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoadingCompliance(false);
      }
    };
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Prefill input when step changes ───────────────────────────────────

  useEffect(() => {
    setInputValue('');
    setAiSuggestion(null);
    setSaveError(null);

    if (phase === 1 && phase1Steps[p1Idx]) {
      setInputValue(phase1Steps[p1Idx].defaultValue);
    }
  }, [phase, p1Idx, p2ProdIdx, p2IssueIdx, phase1Steps]);

  // ── Navigation helpers ─────────────────────────────────────────────────

  const currentP1Step = phase1Steps[p1Idx] ?? null;
  const currentP2Product = phase2Products[p2ProdIdx] ?? null;
  const currentP2Issue = currentP2Product?.issues[p2IssueIdx] ?? null;

  const totalProducts = phase2Products.length;
  const p1Total = phase1Steps.length;

  function advanceP1() {
    if (p1Idx + 1 < phase1Steps.length) {
      setP1Idx((i) => i + 1);
    } else {
      if (phase2Products.length > 0) {
        setPhase(2);
        setP2ProdIdx(0);
        setP2IssueIdx(0);
      } else {
        onComplete();
      }
    }
  }

  function advanceP2Issue() {
    if (!currentP2Product) { onComplete(); return; }
    const nextIssue = p2IssueIdx + 1;
    if (nextIssue < currentP2Product.issues.length) {
      setP2IssueIdx(nextIssue);
    } else {
      advanceP2Product();
    }
  }

  function advanceP2Product() {
    const nextProd = p2ProdIdx + 1;
    if (nextProd < phase2Products.length) {
      setP2ProdIdx(nextProd);
      setP2IssueIdx(0);
    } else {
      onComplete();
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!currentP2Product) return;
    setGenerating(true);
    setSaveError(null);
    try {
      const res = await appFetch('/api/wizard-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: currentP2Product.productId, instanceId: 'default' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const field = currentP2Issue?.field ?? 'description';
      const suggestion = field === 'title' ? data.title : data.description;
      setAiSuggestion(suggestion);
      setInputValue(suggestion);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [currentP2Product, currentP2Issue]);

  const handleSaveP1 = useCallback(async () => {
    if (!currentP1Step) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await appFetch('/api/wizard-apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'global',
          field: currentP1Step.field,
          value: inputValue.trim(),
          instanceId: 'default',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Save failed');
      advanceP1();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [currentP1Step, inputValue, p1Idx, phase1Steps, phase2Products]);

  const handleSaveP2 = useCallback(async () => {
    if (!currentP2Product || !currentP2Issue) return;
    setSaving(true);
    setSaveError(null);
    try {
      const field = currentP2Issue.field;
      const res = await appFetch('/api/wizard-apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'product',
          productId: currentP2Product.productId,
          [field]: inputValue.trim(),
          instanceId: 'default',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Save failed');
      advanceP2Issue();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [currentP2Product, currentP2Issue, inputValue, p2ProdIdx, p2IssueIdx, phase2Products]);

  // ── Render helpers ────────────────────────────────────────────────────

  if (loadingCompliance) {
    return (
      <Box align="center" padding="60px">
        <Loader />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box direction="vertical" gap="16px">
        <SectionHelper appearance="danger">{loadError}</SectionHelper>
        <Button onClick={onComplete} size="small" skin="light">Exit wizard</Button>
      </Box>
    );
  }

  if (phase1Steps.length === 0 && phase2Products.length === 0) {
    return (
      <Box direction="vertical" gap="16px">
        <SectionHelper appearance="success">
          <Text weight="bold">All issues resolved!</Text>
          <Text size="small" secondary>Sync again to push the fixes to Google.</Text>
        </SectionHelper>
        <Button onClick={onComplete} size="small">Done</Button>
      </Box>
    );
  }

  const p1Label = p1Total > 0 ? `Step ${p1Idx + 1} of ${p1Total} — Global fixes` : '';
  const p2Label = totalProducts > 0 && currentP2Product
    ? `Product ${p2ProdIdx + 1} of ${totalProducts} — Per-product fixes`
    : '';

  const p1Done = phase === 2 ? p1Total : p1Idx;
  const p2Done = phase === 2
    ? p2ProdIdx + (p2IssueIdx / Math.max(1, currentP2Product?.issues.length ?? 1))
    : 0;
  const totalSteps = p1Total + totalProducts;
  const progressPct = totalSteps > 0 ? Math.round(((p1Done + p2Done) / totalSteps) * 100) : 0;

  return (
    <Box direction="vertical" gap="16px">
      {/* Exit */}
      <Box>
        <Button size="tiny" skin="light" onClick={onComplete}>← Exit wizard</Button>
      </Box>

      {/* Phase tabs */}
      <Box gap="8px">
        {([1, 2] as const).map((p) => {
          const isDone = p === 1 && phase === 2;
          const isActive = phase === p;
          const isDisabled = p === 2 && phase === 1;
          return (
            <div
              key={p}
              style={{
                flex: 1,
                padding: '10px',
                border: `2px solid ${isDone ? '#a8d9bc' : isActive ? '#116dff' : '#e0e0e0'}`,
                borderRadius: '8px',
                textAlign: 'center' as const,
                cursor: isDisabled ? 'default' : 'pointer',
                background: isDone ? '#f0faf5' : isActive ? '#f0f5ff' : '#fff',
              }}
              onClick={() => { if (!isDisabled) setPhase(p); }}
            >
              <Text
                size="small"
                weight="bold"
                style={{ color: isDone ? '#065f46' : isActive ? '#116dff' : '#aaa' }}
              >
                {isDone ? '✓ ' : ''}{`Phase ${p}`}
              </Text>
              <Text size="tiny" secondary style={{ display: 'block', marginTop: '2px' }}>
                {p === 1 ? 'Global fixes' : 'Per-product fixes'}
              </Text>
            </div>
          );
        })}
      </Box>

      {/* Progress bar */}
      <Box direction="vertical" gap="4px">
        <Box style={{ background: '#eee', borderRadius: '8px', height: '6px', overflow: 'hidden' }}>
          <Box style={{ background: '#116dff', borderRadius: '8px', height: '6px', width: `${progressPct}%` }} />
        </Box>
        <Box style={{ justifyContent: 'space-between', display: 'flex' }}>
          <Text size="tiny" secondary>{phase === 1 ? p1Label : p2Label}</Text>
          <Text size="tiny" secondary>
            {phase === 1
              ? (p1Idx + 1 < p1Total ? `${p1Total - p1Idx - 1} more` : 'Last one')
              : currentP2Product && p2IssueIdx + 1 < currentP2Product.issues.length
                ? `Issue ${p2IssueIdx + 1} of ${currentP2Product.issues.length} for this product`
                : ''}
          </Text>
        </Box>
      </Box>

      {/* Step card */}
      {phase === 1 && currentP1Step && (
        <Phase1StepCard
          step={currentP1Step}
          inputValue={inputValue}
          onInputChange={setInputValue}
          saving={saving}
          saveError={saveError}
          onSave={handleSaveP1}
          onSkip={advanceP1}
        />
      )}

      {phase === 2 && currentP2Product && currentP2Issue && (
        <Phase2StepCard
          product={currentP2Product}
          issue={currentP2Issue}
          productIndex={p2ProdIdx}
          totalProducts={totalProducts}
          inputValue={inputValue}
          onInputChange={setInputValue}
          aiSuggestion={aiSuggestion}
          generating={generating}
          saving={saving}
          saveError={saveError}
          onGenerate={handleGenerate}
          onSave={handleSaveP2}
          onSkipIssue={advanceP2Issue}
          onSkipProduct={advanceP2Product}
        />
      )}
    </Box>
  );
};

// ── Phase1StepCard ─────────────────────────────────────────────────────────

const Phase1StepCard: FC<{
  step: Phase1Step;
  inputValue: string;
  onInputChange: (v: string) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onSkip: () => void;
}> = ({ step, inputValue, onInputChange, saving, saveError, onSave, onSkip }) => (
  <Card>
    <Card.Header
      title={`${FIELD_LABELS[step.field] ?? step.field} isn't set`}
      subtitle="Set it once here — applies to all products automatically."
    />
    <Card.Divider />
    <Card.Content>
      <Box direction="vertical" gap="12px">
        {saveError && <SectionHelper appearance="danger">{saveError}</SectionHelper>}
        <FormField label={FIELD_LABELS[step.field] ?? step.field}>
          {step.field === 'condition' ? (
            <Dropdown
              options={CONDITION_OPTIONS}
              selectedId={inputValue || 'new'}
              onSelect={(opt) => onInputChange(opt.id as string)}
            />
          ) : (
            <Input
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={step.field === 'brand' ? 'e.g. Lake Erie Clothing' : ''}
            />
          )}
        </FormField>
        <Box
          style={{
            background: '#f0f4ff',
            border: '1px solid #c7d7fd',
            borderRadius: '6px',
            padding: '6px 10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Text size="tiny">
            ⚡ Fixes {step.affectsCount} product{step.affectsCount !== 1 ? 's' : ''} at once
          </Text>
        </Box>
        <Box
          style={{
            background: '#f0faf5',
            border: '1px solid #a8d9bc',
            borderRadius: '8px',
            padding: '8px 12px',
          }}
        >
          <Text size="tiny">✓ Saves here and writes back to your Wix products automatically</Text>
        </Box>
      </Box>
    </Card.Content>
    <Card.Divider />
    <Box padding="16px 24px" gap="10px" verticalAlign="middle">
      <Button onClick={onSave} disabled={saving || !inputValue.trim()}>
        {saving ? 'Saving…' : 'Save & Continue →'}
      </Button>
      <Button skin="light" onClick={onSkip} disabled={saving}>Skip for now</Button>
    </Box>
  </Card>
);

// ── Phase2StepCard ─────────────────────────────────────────────────────────

const Phase2StepCard: FC<{
  product: Phase2ProductStep;
  issue: { field: string; errorMessage: string; isImageField: boolean };
  productIndex: number;
  totalProducts: number;
  inputValue: string;
  onInputChange: (v: string) => void;
  aiSuggestion: string | null;
  generating: boolean;
  saving: boolean;
  saveError: string | null;
  onGenerate: () => void;
  onSave: () => void;
  onSkipIssue: () => void;
  onSkipProduct: () => void;
}> = ({
  product, issue, productIndex, totalProducts,
  inputValue, onInputChange,
  aiSuggestion, generating, saving, saveError,
  onGenerate, onSave, onSkipIssue, onSkipProduct,
}) => {
  const isTextualField = issue.field === 'description' || issue.field === 'title';
  const isLongField = issue.field === 'description';

  return (
    <Card>
      <Card.Header subtitle="Phase 2 — Fix Product by Product" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="12px">
          {/* Product mini-card */}
          <Box
            style={{ background: '#f9f9f9', borderRadius: '8px', padding: '10px 12px' }}
            gap="12px"
            verticalAlign="middle"
          >
            {product.productImage && (
              <img
                src={product.productImage}
                alt=""
                style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <Box direction="vertical" style={{ flex: 1 }}>
              <Text size="small" weight="bold">{product.productName}</Text>
              {product.productPrice && <Text size="tiny" secondary>{product.productPrice}</Text>}
            </Box>
            <Text size="tiny" secondary style={{ whiteSpace: 'nowrap' }}>
              {productIndex + 1} / {totalProducts}
            </Text>
          </Box>

          {/* Google's error message */}
          <Box
            style={{
              background: '#fff8f8',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '10px 12px',
            }}
          >
            <Text
              size="tiny"
              weight="bold"
              style={{
                color: '#b91c1c',
                textTransform: 'uppercase' as const,
                letterSpacing: '.4px',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Google says:
            </Text>
            <Text size="small" style={{ color: '#991b1b' }}>{issue.errorMessage}</Text>
          </Box>

          {saveError && <SectionHelper appearance="danger">{saveError}</SectionHelper>}

          {/* Image field — cannot edit inline */}
          {issue.isImageField && (
            <SectionHelper appearance="standard">
              <Text size="small">Product images must be updated in Wix directly.</Text>
              <Box marginTop="8px">
                <Button
                  as="a"
                  href="https://manage.wix.com/store/products"
                  target="_blank"
                  size="small"
                  skin="light"
                >
                  Edit in Wix →
                </Button>
              </Box>
            </SectionHelper>
          )}

          {/* Textual field — inline edit + SyncStream AI */}
          {isTextualField && (
            <>
              {/* SyncStream AI button */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #f0f4ff, #fdf4ff)',
                  border: '1px solid #c4b5fd',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  cursor: generating ? 'default' : 'pointer',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                }}
                onClick={generating ? undefined : onGenerate}
              >
                <Text size="small">✨</Text>
                <Box direction="vertical" style={{ flex: 1 }}>
                  <Text size="small" weight="bold" style={{ color: '#5b21b6' }}>
                    Write with SyncStream
                  </Text>
                  <Text size="tiny" style={{ color: '#7c3aed' }}>
                    SyncStream writes a {issue.field === 'title' ? 'title' : 'description'} based on
                    the product name and category — you review it first
                  </Text>
                </Box>
                <Button
                  size="small"
                  onClick={(e: MouseEvent) => { e.stopPropagation(); onGenerate(); }}
                  disabled={generating}
                >
                  {generating ? 'Generating…' : 'Generate →'}
                </Button>
              </div>

              {aiSuggestion && (
                <Box
                  style={{
                    background: '#fdf9ff',
                    border: '1px solid #ddd6fe',
                    borderRadius: '8px',
                    padding: '10px 12px',
                  }}
                >
                  <Text
                    size="tiny"
                    weight="bold"
                    style={{
                      color: '#7c3aed',
                      textTransform: 'uppercase' as const,
                      letterSpacing: '.4px',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    ✨ SyncStream suggestion — edit before saving
                  </Text>
                  <Text size="small">{aiSuggestion}</Text>
                </Box>
              )}

              <FormField
                label={`${FIELD_LABELS[issue.field] ?? issue.field} — or write your own`}
              >
                {isLongField ? (
                  <InputArea
                    value={inputValue}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder="Describe this product for Google shoppers…"
                    rows={5}
                  />
                ) : (
                  <Input
                    value={inputValue}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder="Product title…"
                  />
                )}
              </FormField>

              <Box
                style={{
                  background: '#f0faf5',
                  border: '1px solid #a8d9bc',
                  borderRadius: '8px',
                  padding: '8px 12px',
                }}
              >
                <Text size="tiny">
                  ✓ Saves here and writes back to your Wix product automatically
                </Text>
              </Box>
            </>
          )}
        </Box>
      </Card.Content>
      <Card.Divider />
      <Box padding="16px 24px" gap="10px" verticalAlign="middle">
        {issue.isImageField ? (
          <Button onClick={onSkipIssue} size="small" skin="light">Next →</Button>
        ) : (
          <>
            <Button onClick={onSave} disabled={saving || !inputValue.trim()}>
              {saving ? 'Saving…' : 'Save & Next →'}
            </Button>
            <Button skin="light" onClick={onSkipIssue} disabled={saving}>
              Skip this issue
            </Button>
          </>
        )}
        <Box style={{ marginLeft: 'auto' }}>
          <Button skin="light" size="small" onClick={onSkipProduct} disabled={saving}>
            Skip this product
          </Button>
        </Box>
      </Box>
    </Card>
  );
};
