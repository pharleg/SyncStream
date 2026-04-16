# Fix Issues Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-phase guided wizard that walks merchants through fixing GMC compliance errors one step at a time, editing inline with automatic Wix backflow.

**Architecture:** A new `FixWizard.tsx` component replaces the dashboard panel content when active. Phase 1 handles global fixes (brand, condition) by writing store-level defaults to `AppConfig.fieldMappings`. Phase 2 handles per-product fixes (title, description) by writing directly to Wix via `applyEnhancementsToWix`. Two new API endpoints handle the wizard's backend needs. The wizard is wired into both `DashboardTab` (from `SetupModeView`) and `ProductsTab`.

**Tech Stack:** React + TypeScript, Wix Design System (`@wix/design-system`), existing `appFetch` helper, `/api/compliance-check` for structured error data, new `/api/wizard-generate` and `/api/wizard-apply-fix` endpoints.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/pages/api/wizard-generate.ts` | Create | AI suggestion for a single product |
| `src/pages/api/wizard-apply-fix.ts` | Create | Apply one fix (product or global) to Wix / AppConfig |
| `src/extensions/dashboard/pages/sync-stream/FixWizard.tsx` | Create | The wizard component |
| `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx` | Modify | Wire wizard into DashboardTab + ProductsTab |

---

## Task 1: `POST /api/wizard-generate` endpoint

**Files:**
- Create: `src/pages/api/wizard-generate.ts`

- [ ] **Step 1: Create the file**

```typescript
/**
 * POST /api/wizard-generate
 *
 * Generates an AI title + description suggestion for a single product.
 * Body: { productId: string; instanceId?: string }
 * Response: { title: string; description: string }
 */
import type { APIRoute } from 'astro';
import { getCachedProductsByIds, getAppConfig } from '../../backend/dataService';
import { enhanceProduct } from '../../backend/aiEnhancer';
import type { WixProduct } from '../../types/wix.types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const productId: string = body.productId;
    const instanceId: string = body.instanceId ?? 'default';

    if (!productId) {
      return new Response(JSON.stringify({ error: 'productId required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const [cached, config] = await Promise.all([
      getCachedProductsByIds(instanceId, [productId]),
      getAppConfig(instanceId),
    ]);

    if (!cached.length) {
      return new Response(JSON.stringify({ error: 'Product not found in cache' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const product = cached[0].productData as WixProduct;
    const enhanced = await enhanceProduct(product, instanceId, config?.aiEnhancementStyle);

    return new Response(
      JSON.stringify({ title: enhanced.title, description: enhanced.description }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/curtismcewen/Documents/Git/SyncStream/sync-stream
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/wizard-generate.ts
git commit -m "feat: add wizard-generate endpoint for AI suggestions"
```

---

## Task 2: `POST /api/wizard-apply-fix` endpoint

**Files:**
- Create: `src/pages/api/wizard-apply-fix.ts`

- [ ] **Step 1: Create the file**

This endpoint handles two fix types:
- `product`: writes `title` and/or `description` for a single product to Wix and updates the products cache
- `global`: writes `brand` or `condition` to `AppConfig.fieldMappings` as a store-level default

```typescript
/**
 * POST /api/wizard-apply-fix
 *
 * Applies a single wizard fix — either product-level (title/description → Wix)
 * or global (brand/condition → AppConfig.fieldMappings).
 *
 * Body (product fix):
 *   { type: 'product'; productId: string; title?: string; description?: string; instanceId?: string }
 *
 * Body (global fix):
 *   { type: 'global'; field: 'brand' | 'condition'; value: string; instanceId?: string }
 *
 * Response: { success: boolean; error?: string }
 */
import type { APIRoute } from 'astro';
import { getAppConfig, saveAppConfig, updateCachedProductFields } from '../../backend/dataService';
import { applyEnhancementsToWix } from '../../backend/aiEnhancer';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const instanceId: string = body.instanceId ?? 'default';

    // ── Product fix: write title/description to Wix ──────────────────────
    if (body.type === 'product') {
      const { productId, title, description } = body as {
        productId: string;
        title?: string;
        description?: string;
      };

      if (!productId) {
        return new Response(JSON.stringify({ success: false, error: 'productId required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!title && !description) {
        return new Response(JSON.stringify({ success: false, error: 'title or description required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }

      const results = await applyEnhancementsToWix(instanceId, [{
        productId,
        title: title ?? '',
        description: description ?? '',
      }]);

      const result = results[0];
      if (!result.success) {
        return new Response(
          JSON.stringify({ success: false, error: result.error ?? 'Wix update failed' }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Update products cache
      const cacheFields: { name?: string; description?: string; plainDescription?: string } = {};
      if (title) { cacheFields.name = title; }
      if (description) { cacheFields.description = description; cacheFields.plainDescription = description; }
      await updateCachedProductFields(instanceId, productId, cacheFields);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Global fix: write brand/condition to AppConfig.fieldMappings ─────
    if (body.type === 'global') {
      const { field, value } = body as { field: 'brand' | 'condition'; value: string };

      if (!field || !value) {
        return new Response(JSON.stringify({ success: false, error: 'field and value required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }

      const config = await getAppConfig(instanceId);
      if (!config) {
        return new Response(JSON.stringify({ success: false, error: 'AppConfig not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }

      config.fieldMappings = {
        ...config.fieldMappings,
        [field]: { type: 'default', defaultValue: value },
      };
      await saveAppConfig(config);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'type must be "product" or "global"' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/wizard-apply-fix.ts
git commit -m "feat: add wizard-apply-fix endpoint for product and global fixes"
```

---

## Task 3: `FixWizard.tsx` component

**Files:**
- Create: `src/extensions/dashboard/pages/sync-stream/FixWizard.tsx`

The wizard has three top-level concerns:
1. On mount: call `/api/compliance-check` to get structured per-product errors (`{ field, message, severity }`)
2. Derive Phase 1 steps (global fields: brand, condition) from `issueGroups` prop
3. Derive Phase 2 steps (per-product, depth-first) from compliance check results

### Step 1: Create the file with types and data derivation

- [ ] **Step 1: Write `FixWizard.tsx`**

```tsx
import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Dropdown,
  FormField,
  Input,
  InputArea,
  Text,
  Badge,
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
            // Only include fields we can address in the wizard
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
  }, [phase, p1Idx, p2ProdIdx, p2IssueIdx]);

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
      // Phase 1 done — move to Phase 2
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
          [field === 'title' ? 'title' : 'description']: inputValue.trim(),
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

  // Phase progress labels
  const p1Label = p1Total > 0
    ? `Step ${p1Idx + 1} of ${p1Total} — Global fixes`
    : '';
  const p2Label = totalProducts > 0 && currentP2Product
    ? `Product ${p2ProdIdx + 1} of ${totalProducts} — Per-product fixes`
    : '';

  // Overall progress percentage
  const p1Done = phase === 2 ? p1Total : p1Idx;
  const p2Done = phase === 2
    ? p2ProdIdx + (p2IssueIdx / Math.max(1, currentP2Product?.issues.length ?? 1))
    : 0;
  const totalSteps = p1Total + totalProducts;
  const progressPct = totalSteps > 0
    ? Math.round(((p1Done + p2Done) / totalSteps) * 100)
    : 0;

  return (
    <Box direction="vertical" gap="16px">
      {/* Exit */}
      <Box>
        <Button size="tiny" skin="light" onClick={onComplete}>← Exit wizard</Button>
      </Box>

      {/* Phase tabs */}
      <Box gap="8px">
        {[1, 2].map((p) => {
          const isDone = (p === 1 && phase === 2);
          const isActive = phase === p;
          const isDisabled = p === 2 && phase === 1;
          return (
            <Box
              key={p}
              style={{
                flex: 1,
                padding: '10px',
                border: `2px solid ${isDone ? '#a8d9bc' : isActive ? '#116dff' : '#e0e0e0'}`,
                borderRadius: '8px',
                textAlign: 'center',
                cursor: isDisabled ? 'default' : 'pointer',
                background: isDone ? '#f0faf5' : isActive ? '#f0f5ff' : '#fff',
              }}
              onClick={() => { if (!isDisabled) setPhase(p as 1 | 2); }}
            >
              <Text size="small" weight="bold" style={{ color: isDone ? '#065f46' : isActive ? '#116dff' : '#aaa' }}>
                {isDone ? '✓ ' : ''}{`Phase ${p}`}
              </Text>
              <Text size="tiny" secondary style={{ display: 'block', marginTop: '2px' }}>
                {p === 1 ? 'Global fixes' : 'Per-product fixes'}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Progress bar */}
      <Box direction="vertical" gap="4px">
        <Box style={{ background: '#eee', borderRadius: '8px', height: '6px', overflow: 'hidden' }}>
          <Box style={{ background: '#116dff', borderRadius: '8px', height: '6px', width: `${progressPct}%` }} />
        </Box>
        <Box justifyContent="space-between">
          <Text size="tiny" secondary>{phase === 1 ? p1Label : p2Label}</Text>
          <Text size="tiny" secondary>
            {phase === 1
              ? (p1Idx + 1 < p1Total ? `${p1Total - p1Idx - 1} more` : 'Last one')
              : currentP2Product && p2IssueIdx + 1 < (currentP2Product.issues.length)
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
      subtitle={`Set it once here — applies to all products automatically.`}
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
        <Box style={{
          background: '#f0f4ff',
          border: '1px solid #c7d7fd',
          borderRadius: '6px',
          padding: '6px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <Text size="tiny">⚡ Fixes {step.affectsCount} product{step.affectsCount !== 1 ? 's' : ''} at once</Text>
        </Box>
        <Box style={{
          background: '#f0faf5',
          border: '1px solid #a8d9bc',
          borderRadius: '8px',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
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
            <Text size="tiny" secondary style={{ whiteSpace: 'nowrap' }}>{productIndex + 1} / {totalProducts}</Text>
          </Box>

          {/* Google's error message */}
          <Box style={{
            background: '#fff8f8',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '10px 12px',
          }}>
            <Text size="tiny" weight="bold" style={{ color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: 4 }}>Google says:</Text>
            <Text size="small" style={{ color: '#991b1b' }}>{issue.errorMessage}</Text>
          </Box>

          {saveError && <SectionHelper appearance="danger">{saveError}</SectionHelper>}

          {/* Image field — can't edit inline */}
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

          {/* Textual field — inline edit + AI */}
          {isTextualField && (
            <>
              {/* SyncStream AI button */}
              <Box
                style={{
                  background: 'linear-gradient(135deg, #f0f4ff, #fdf4ff)',
                  border: '1px solid #c4b5fd',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  cursor: generating ? 'default' : 'pointer',
                }}
                gap="10px"
                verticalAlign="middle"
                onClick={generating ? undefined : onGenerate}
              >
                <Text size="small">✨</Text>
                <Box direction="vertical" style={{ flex: 1 }}>
                  <Text size="small" weight="bold" style={{ color: '#5b21b6' }}>Write with SyncStream</Text>
                  <Text size="tiny" style={{ color: '#7c3aed' }}>
                    SyncStream writes a {issue.field === 'title' ? 'title' : 'description'} based on
                    the product name and category — you review it first
                  </Text>
                </Box>
                <Button
                  size="small"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); onGenerate(); }}
                  disabled={generating}
                >
                  {generating ? 'Generating…' : 'Generate →'}
                </Button>
              </Box>

              {aiSuggestion && (
                <Box style={{
                  background: '#fdf9ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: '8px',
                  padding: '10px 12px',
                }}>
                  <Text size="tiny" weight="bold" style={{ color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.4px', display: 'block', marginBottom: 6 }}>
                    ✨ SyncStream suggestion — edit before saving
                  </Text>
                  <Text size="small">{aiSuggestion}</Text>
                </Box>
              )}

              <FormField label={`${FIELD_LABELS[issue.field] ?? issue.field} — or write your own`}>
                {isLongField ? (
                  <InputArea
                    value={inputValue}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder={`Describe this product for Google shoppers…`}
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

              <Box style={{
                background: '#f0faf5',
                border: '1px solid #a8d9bc',
                borderRadius: '8px',
                padding: '8px 12px',
              }}>
                <Text size="tiny">✓ Saves here and writes back to your Wix product automatically</Text>
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
            <Button skin="light" onClick={onSkipIssue} disabled={saving}>Skip this issue</Button>
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors. If `InputArea` import fails, check exact export name with:
```bash
grep -r "export.*InputArea\|InputArea" node_modules/@wix/design-system/dist/types/index.d.ts 2>/dev/null | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/FixWizard.tsx
git commit -m "feat: add FixWizard component — two-phase guided error remediation"
```

---

## Task 4: Wire wizard into `DashboardTab` + `SetupModeView`

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

The goal: when the merchant clicks "Fix Issues →" in `SetupModeView`, the wizard replaces the dashboard panel. When the wizard exits or completes, the panel reverts to `SetupModeView` and refreshes data.

- [ ] **Step 1: Add import for `FixWizard` at the top of `sync-stream.tsx`**

Find the line (currently line 1):
```typescript
import { type FC, useState, useEffect, useCallback } from 'react';
```

Add below the last import block (before `async function appFetch`):
```typescript
import { FixWizard } from './FixWizard';
```

- [ ] **Step 2: Add `onLaunchWizard` prop to `SetupModeView`**

Find `SetupModeView` declaration (around line 2173):
```typescript
const SetupModeView: FC<{
  syncSummary: SyncSummary;
  onTabChange: (tab: string) => void;
}> = ({ syncSummary, onTabChange }) => {
```

Replace with:
```typescript
const SetupModeView: FC<{
  syncSummary: SyncSummary;
  onTabChange: (tab: string) => void;
  onLaunchWizard: () => void;
}> = ({ syncSummary, onTabChange, onLaunchWizard }) => {
```

- [ ] **Step 3: Add "Fix Issues →" button to `SetupModeView`**

In `SetupModeView`, find the closing of the `SectionHelper` block (the `</SectionHelper>` after the subtitle `Text`). The current JSX is:

```tsx
      <SectionHelper appearance="warning">
        <Text weight="bold">
          {syncSummary.totalErrors} product{syncSummary.totalErrors !== 1 ? 's' : ''} couldn't sync
          {hasValidationIssues
            ? issueCount === 1
              ? ' — 1 thing to fix'
              : ` — ${issueCount} things to fix`
            : ' — review errors in the Products tab'}
        </Text>
        <Text size="small" secondary>
          {hasValidationIssues
            ? 'Complete the steps below, then sync again to go live.'
            : 'These products were rejected by Google Merchant Center. Check the Products tab for details on each error.'}
        </Text>
      </SectionHelper>
```

Replace with:
```tsx
      <SectionHelper appearance="warning">
        <Text weight="bold">
          {syncSummary.totalErrors} product{syncSummary.totalErrors !== 1 ? 's' : ''} couldn't sync
          {hasValidationIssues
            ? issueCount === 1
              ? ' — 1 thing to fix'
              : ` — ${issueCount} things to fix`
            : ' — review errors in the Products tab'}
        </Text>
        <Text size="small" secondary>
          {hasValidationIssues
            ? 'Complete the steps below, then sync again to go live.'
            : 'These products were rejected by Google Merchant Center. Check the Products tab for details on each error.'}
        </Text>
        <Box marginTop="12px">
          <Button onClick={onLaunchWizard} size="small">Fix Issues →</Button>
        </Box>
      </SectionHelper>
```

- [ ] **Step 4: Add `wizardActive` state and handler in `DashboardTab`**

In `DashboardTab`, after the existing state declarations (around line 2262, after `const [syncProgress, setSyncProgress] = useState...`), add:

```typescript
  const [wizardActive, setWizardActive] = useState(false);
```

- [ ] **Step 5: Replace `SetupModeView` render in `DashboardTab` with wizard-aware block**

Find this block (around line 2359):
```tsx
  if (dashboardState === 'setup-mode' && data) {
    return (
      <Box direction="vertical" gap="16px">
        <SetupModeView syncSummary={data} onTabChange={onTabChange} />
        {/* Still show the Sync Now button so they can re-sync after fixing */}
        <Box>
          <Button onClick={handleSync} disabled={syncing} size="small" skin="light">
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        </Box>
        {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      </Box>
    );
  }
```

Replace with:
```tsx
  if (dashboardState === 'setup-mode' && data) {
    if (wizardActive && config) {
      return (
        <FixWizard
          issueGroups={data.issueGroups}
          config={config}
          onComplete={async () => {
            setWizardActive(false);
            await loadData();
            await onRefresh();
          }}
        />
      );
    }
    return (
      <Box direction="vertical" gap="16px">
        <SetupModeView
          syncSummary={data}
          onTabChange={onTabChange}
          onLaunchWizard={() => setWizardActive(true)}
        />
        {/* Still show the Sync Now button so they can re-sync after fixing */}
        <Box>
          <Button onClick={handleSync} disabled={syncing} size="small" skin="light">
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        </Box>
        {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      </Box>
    );
  }
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: wire FixWizard into DashboardTab setup-mode view"
```

---

## Task 5: Wire wizard into `ProductsTab`

**Files:**
- Modify: `src/extensions/dashboard/pages/sync-stream/sync-stream.tsx`

The wizard in ProductsTab needs `issueGroups` which isn't currently loaded there. Fetch sync status when launching the wizard to get them.

- [ ] **Step 1: Add `wizardActive` and `wizardIssueGroups` state to `ProductsTab`**

In `ProductsTab`, after `const [openOverridePopover, setOpenOverridePopover] = useState<string | null>(null);` (around line 1057), add:

```typescript
  const [wizardActive, setWizardActive] = useState(false);
  const [wizardIssueGroups, setWizardIssueGroups] = useState<IssueGroup[]>([]);
  const [launchingWizard, setLaunchingWizard] = useState(false);
```

- [ ] **Step 2: Add `handleLaunchWizard` in `ProductsTab`**

After the existing `useCallback` hooks in ProductsTab, add:

```typescript
  const handleLaunchWizard = useCallback(async () => {
    setLaunchingWizard(true);
    try {
      const res = await appFetch('/api/sync-status?instanceId=default');
      const data = await res.json();
      setWizardIssueGroups(data.issueGroups ?? []);
      setWizardActive(true);
    } catch {
      setWizardIssueGroups([]);
      setWizardActive(true);
    } finally {
      setLaunchingWizard(false);
    }
  }, []);
```

- [ ] **Step 3: Add wizard render in `ProductsTab`**

Find the top of the ProductsTab return statement. It starts with:
```tsx
  return (
    <Box direction="vertical" gap="16px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">{success}</SectionHelper>}
```

Replace with:
```tsx
  return (
    <Box direction="vertical" gap="16px">
      {wizardActive && config && (
        <FixWizard
          issueGroups={wizardIssueGroups}
          config={{ instanceId: config.instanceId ?? 'default', fieldMappings: (config.fieldMappings ?? {}) as any }}
          onComplete={async () => {
            setWizardActive(false);
            await loadProducts();
          }}
        />
      )}
      {!wizardActive && (
        <Box direction="vertical" gap="16px">
      {error && <SectionHelper appearance="danger">{error}</SectionHelper>}
      {success && <SectionHelper appearance="success">{success}</SectionHelper>}
```

Then find the final `</Box>` that closes the ProductsTab return and add `</Box>)}` before it:
```tsx
        </Box>  {/* closes !wizardActive Box */}
      )}        {/* closes !wizardActive conditional */}
    </Box>      {/* closes outer Box */}
  );
```

- [ ] **Step 4: Add "Fix Issues →" button in the Products tab error area**

Find where products with errors are counted/shown. Look for where `SectionHelper` or error counts are shown at the top of the products sub-tab. Find the error count display (look for `totalErrors` or the error badge count area near the top of the products tab render).

Specifically, find the `TableToolbar` or the area above the products table where you can add a "Fix Issues →" button. Search for:
```tsx
<TableToolbar>
```

Add before `<TableToolbar>`:
```tsx
{products.filter(p => p.syncStatus?.status === 'error').length > 0 && (
  <Box marginBottom="12px" verticalAlign="middle" gap="12px">
    <Text size="small" secondary>
      {products.filter(p => p.syncStatus?.status === 'error').length} product{products.filter(p => p.syncStatus?.status === 'error').length !== 1 ? 's' : ''} have sync errors
    </Text>
    <Button
      size="small"
      onClick={handleLaunchWizard}
      disabled={launchingWizard}
    >
      {launchingWizard ? 'Loading…' : 'Fix Issues →'}
    </Button>
  </Box>
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors. If `loadProducts` is not defined (it may be called `loadData` or similar), find the correct function name:
```bash
grep -n "const load\|loadProducts\|setProducts" src/extensions/dashboard/pages/sync-stream/sync-stream.tsx | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/extensions/dashboard/pages/sync-stream/sync-stream.tsx
git commit -m "feat: wire FixWizard into ProductsTab with Fix Issues button"
```

---

## Manual Verification Checklist

After all tasks are complete, test in `wix dev`:

- [ ] **Setup flow**: Connect GMC → sync → errors appear in SetupModeView → "Fix Issues →" button visible → clicking opens wizard → Phase 1 shows for brand/condition if applicable → Phase 2 shows per-product errors → saving writes to Wix → exiting returns to SetupModeView
- [ ] **Products tab**: Error products load → "Fix Issues →" button visible → clicking opens wizard → wizard works → exiting returns to products table
- [ ] **AI generation**: Click "Generate →" on a description step → loader shows → suggestion fills textarea → can edit before saving
- [ ] **Image field**: When a product has an imageLink error → wizard shows "Edit in Wix →" link → "Next →" advances without saving
- [ ] **Skip**: "Skip for now" on Phase 1 advances without saving; "Skip this issue" advances within a product; "Skip this product" jumps to next product
- [ ] **Completion**: After last step, `onComplete` fires → panel reverts to previous view
