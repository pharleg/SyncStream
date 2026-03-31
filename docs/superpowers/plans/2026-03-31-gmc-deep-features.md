# GMC Deep Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filter engine, rules engine, and AI description enhancement to the existing GMC sync pipeline, all platform-aware for future Meta support.

**Architecture:** Three new pure-function modules (filterEngine, rulesEngine, aiEnhancer) plug into syncService.ts's pipeline between fetch and push. New Supabase tables store rules, filters, and cached AI content. dataService.ts gets CRUD functions for the new tables. Dashboard gets Rules/Filters tabs on the mapping page and AI controls on settings.

**Tech Stack:** TypeScript, Supabase (Postgres), Anthropic Claude API (Haiku 4.5), Wix CLI (React + Wix Design System), existing sync pipeline.

**Spec:** `docs/superpowers/specs/2026-03-31-gmc-deep-features-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/types/rules.types.ts` | SyncRule, SyncFilter, EnhancedContent, expression types |
| `src/backend/filterEngine.ts` | Evaluate filters against WixProduct[], return filtered list |
| `src/backend/rulesEngine.ts` | Apply transformation rules to GmcProductInput[] |
| `src/backend/aiEnhancer.ts` | Claude API integration, source hashing, cache management |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/wix.types.ts` | Add `aiEnhancementEnabled`, `aiEnhancementStyle` to AppConfig |
| `src/backend/dataService.ts` | Add CRUD for sync_rules, sync_filters, enhanced_content tables |
| `src/backend/productMapper.ts` | Extract `flattenVariants()` as standalone export, add material/pattern to extractChoiceValues |
| `src/backend/syncService.ts` | Rewire pipeline: fetch → filter → flatten → enhance → map → rules → validate → push |
| `src/extensions/dashboard/pages/mapping/mapping.tsx` | Add Rules tab and Filters tab |
| `src/extensions/dashboard/pages/settings/settings.tsx` | Add AI enhancement toggle and "Enhance All" button |

### New Supabase Migrations
| Migration | Tables |
|-----------|--------|
| `supabase/migrations/20260331_sync_rules.sql` | sync_rules |
| `supabase/migrations/20260331_sync_filters.sql` | sync_filters |
| `supabase/migrations/20260331_enhanced_content.sql` | enhanced_content |
| `supabase/migrations/20260331_app_config_ai.sql` | Add ai columns to app_config |

---

## Task 1: Types — Rules, Filters, EnhancedContent

**Files:**
- Create: `src/types/rules.types.ts`
- Modify: `src/types/wix.types.ts:92-101`

- [ ] **Step 1: Create rules.types.ts**

```typescript
// src/types/rules.types.ts

import type { Platform } from './sync.types';

/** Expression for concatenate rules — joins field refs and literals. */
export interface ConcatenateExpression {
  parts: Array<
    | { type: 'field'; value: string }
    | { type: 'literal'; value: string }
  >;
}

/** Expression for static rules — fixed value override. */
export interface StaticExpression {
  value: string;
}

/** Expression for calculator rules — arithmetic on a numeric field. */
export interface CalculatorExpression {
  field: string;
  operator: '+' | '-' | '*' | '/';
  operand: number;
}

export type RuleExpression =
  | ConcatenateExpression
  | StaticExpression
  | CalculatorExpression;

/** A transformation rule applied to mapped product data. */
export interface SyncRule {
  id: string;
  instanceId: string;
  name: string;
  platform: Platform | 'both';
  field: string;
  type: 'concatenate' | 'static' | 'calculator';
  expression: RuleExpression;
  order: number;
  enabled: boolean;
}

/** A filter that excludes products from sync. */
export interface SyncFilter {
  id: string;
  instanceId: string;
  name: string;
  platform: Platform | 'both';
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  value: string;
  conditionGroup: 'AND' | 'OR';
  order: number;
  enabled: boolean;
}

/** Cached AI-enhanced content for a product. */
export interface EnhancedContent {
  id: string;
  instanceId: string;
  productId: string;
  platform: Platform | 'both';
  enhancedTitle?: string;
  enhancedDescription: string;
  sourceHash: string;
  generatedAt: string;
}
```

- [ ] **Step 2: Add AI fields to AppConfig in wix.types.ts**

In `src/types/wix.types.ts`, add two fields to the `AppConfig` interface after `gmcDataSourceId`:

```typescript
// Add after line 100 (gmcDataSourceId)
  /** Whether AI description enhancement is enabled. */
  aiEnhancementEnabled?: boolean;
  /** Optional style/tone instructions for AI enhancement. */
  aiEnhancementStyle?: string;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/rules.types.ts src/types/wix.types.ts
git commit -m "feat: add types for sync rules, filters, and AI enhanced content"
```

---

## Task 2: Supabase Migrations

**Files:**
- Create: `supabase/migrations/20260331_sync_rules.sql`
- Create: `supabase/migrations/20260331_sync_filters.sql`
- Create: `supabase/migrations/20260331_enhanced_content.sql`
- Create: `supabase/migrations/20260331_app_config_ai.sql`

- [ ] **Step 1: Create sync_rules migration**

```sql
-- supabase/migrations/20260331_sync_rules.sql
CREATE TABLE IF NOT EXISTS sync_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('gmc', 'meta', 'both')),
  field text NOT NULL,
  type text NOT NULL CHECK (type IN ('concatenate', 'static', 'calculator')),
  expression jsonb NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_rules_instance ON sync_rules(instance_id);
```

- [ ] **Step 2: Create sync_filters migration**

```sql
-- supabase/migrations/20260331_sync_filters.sql
CREATE TABLE IF NOT EXISTS sync_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('gmc', 'meta', 'both')),
  field text NOT NULL,
  operator text NOT NULL CHECK (operator IN ('equals', 'not_equals', 'contains', 'greater_than', 'less_than')),
  value text NOT NULL,
  condition_group text NOT NULL DEFAULT 'AND' CHECK (condition_group IN ('AND', 'OR')),
  "order" integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_filters_instance ON sync_filters(instance_id);
```

- [ ] **Step 3: Create enhanced_content migration**

```sql
-- supabase/migrations/20260331_enhanced_content.sql
CREATE TABLE IF NOT EXISTS enhanced_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL,
  product_id text NOT NULL,
  platform text NOT NULL DEFAULT 'both' CHECK (platform IN ('gmc', 'meta', 'both')),
  enhanced_title text,
  enhanced_description text NOT NULL,
  source_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, product_id, platform)
);

CREATE INDEX idx_enhanced_content_lookup ON enhanced_content(instance_id, product_id);
```

- [ ] **Step 4: Create app_config AI columns migration**

```sql
-- supabase/migrations/20260331_app_config_ai.sql
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS ai_enhancement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_enhancement_style text;
```

- [ ] **Step 5: Apply migrations to Supabase**

Run each migration against the Supabase project. Use the Supabase MCP tool `apply_migration` or execute via `execute_sql`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add Supabase migrations for rules, filters, and enhanced content"
```

---

## Task 3: dataService.ts — CRUD for Rules, Filters, Enhanced Content

**Files:**
- Modify: `src/backend/dataService.ts`

- [ ] **Step 1: Add getRules and saveRule functions**

Add after the existing `querySyncStates` function (after line 162):

```typescript
import type { SyncRule, SyncFilter, EnhancedContent } from '../types/rules.types';
import type { Platform } from '../types/sync.types';

// ── Rules CRUD ──

export async function getRules(
  instanceId: string,
  platform: Platform,
): Promise<SyncRule[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_rules')
    .select('*')
    .eq('instance_id', instanceId)
    .in('platform', [platform, 'both'])
    .eq('enabled', true)
    .order('order', { ascending: true });

  if (error) throw new Error(`Failed to fetch rules: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    name: row.name,
    platform: row.platform,
    field: row.field,
    type: row.type,
    expression: row.expression,
    order: row.order,
    enabled: row.enabled,
  }));
}

export async function getAllRules(instanceId: string): Promise<SyncRule[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_rules')
    .select('*')
    .eq('instance_id', instanceId)
    .order('order', { ascending: true });

  if (error) throw new Error(`Failed to fetch rules: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    name: row.name,
    platform: row.platform,
    field: row.field,
    type: row.type,
    expression: row.expression,
    order: row.order,
    enabled: row.enabled,
  }));
}

export async function saveRule(rule: Omit<SyncRule, 'id'> & { id?: string }): Promise<string> {
  const db = await getClient();
  const row = {
    ...(rule.id ? { id: rule.id } : {}),
    instance_id: rule.instanceId,
    name: rule.name,
    platform: rule.platform,
    field: rule.field,
    type: rule.type,
    expression: rule.expression,
    order: rule.order,
    enabled: rule.enabled,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('sync_rules')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save rule: ${error.message}`);
  return data.id;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const db = await getClient();
  const { error } = await db.from('sync_rules').delete().eq('id', ruleId);
  if (error) throw new Error(`Failed to delete rule: ${error.message}`);
}
```

- [ ] **Step 2: Add getFilters and saveFilter functions**

```typescript
// ── Filters CRUD ──

export async function getFilters(
  instanceId: string,
  platform: Platform,
): Promise<SyncFilter[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_filters')
    .select('*')
    .eq('instance_id', instanceId)
    .in('platform', [platform, 'both'])
    .eq('enabled', true)
    .order('order', { ascending: true });

  if (error) throw new Error(`Failed to fetch filters: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    name: row.name,
    platform: row.platform,
    field: row.field,
    operator: row.operator,
    value: row.value,
    conditionGroup: row.condition_group,
    order: row.order,
    enabled: row.enabled,
  }));
}

export async function getAllFilters(instanceId: string): Promise<SyncFilter[]> {
  const db = await getClient();
  const { data, error } = await db
    .from('sync_filters')
    .select('*')
    .eq('instance_id', instanceId)
    .order('order', { ascending: true });

  if (error) throw new Error(`Failed to fetch filters: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    instanceId: row.instance_id,
    name: row.name,
    platform: row.platform,
    field: row.field,
    operator: row.operator,
    value: row.value,
    conditionGroup: row.condition_group,
    order: row.order,
    enabled: row.enabled,
  }));
}

export async function saveFilter(filter: Omit<SyncFilter, 'id'> & { id?: string }): Promise<string> {
  const db = await getClient();
  const row = {
    ...(filter.id ? { id: filter.id } : {}),
    instance_id: filter.instanceId,
    name: filter.name,
    platform: filter.platform,
    field: filter.field,
    operator: filter.operator,
    value: filter.value,
    condition_group: filter.conditionGroup,
    order: filter.order,
    enabled: filter.enabled,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('sync_filters')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save filter: ${error.message}`);
  return data.id;
}

export async function deleteFilter(filterId: string): Promise<void> {
  const db = await getClient();
  const { error } = await db.from('sync_filters').delete().eq('id', filterId);
  if (error) throw new Error(`Failed to delete filter: ${error.message}`);
}
```

- [ ] **Step 3: Add Enhanced Content CRUD functions**

```typescript
// ── Enhanced Content CRUD ──

export async function getEnhancedContent(
  instanceId: string,
  productId: string,
  platform: Platform | 'both' = 'both',
): Promise<EnhancedContent | null> {
  const db = await getClient();
  const { data, error } = await db
    .from('enhanced_content')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('product_id', productId)
    .in('platform', [platform, 'both'])
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    instanceId: data.instance_id,
    productId: data.product_id,
    platform: data.platform,
    enhancedTitle: data.enhanced_title ?? undefined,
    enhancedDescription: data.enhanced_description,
    sourceHash: data.source_hash,
    generatedAt: data.generated_at,
  };
}

export async function getBulkEnhancedContent(
  instanceId: string,
  productIds: string[],
): Promise<Map<string, EnhancedContent>> {
  const db = await getClient();
  const { data, error } = await db
    .from('enhanced_content')
    .select('*')
    .eq('instance_id', instanceId)
    .in('product_id', productIds);

  if (error) throw new Error(`Failed to fetch enhanced content: ${error.message}`);

  const map = new Map<string, EnhancedContent>();
  for (const row of data ?? []) {
    map.set(row.product_id, {
      id: row.id,
      instanceId: row.instance_id,
      productId: row.product_id,
      platform: row.platform,
      enhancedTitle: row.enhanced_title ?? undefined,
      enhancedDescription: row.enhanced_description,
      sourceHash: row.source_hash,
      generatedAt: row.generated_at,
    });
  }
  return map;
}

export async function saveEnhancedContent(content: Omit<EnhancedContent, 'id'>): Promise<void> {
  const db = await getClient();
  const { error } = await db
    .from('enhanced_content')
    .upsert(
      {
        instance_id: content.instanceId,
        product_id: content.productId,
        platform: content.platform,
        enhanced_title: content.enhancedTitle ?? null,
        enhanced_description: content.enhancedDescription,
        source_hash: content.sourceHash,
        generated_at: content.generatedAt,
      },
      { onConflict: 'instance_id,product_id,platform' },
    );

  if (error) throw new Error(`Failed to save enhanced content: ${error.message}`);
}
```

- [ ] **Step 4: Update getAppConfig and saveAppConfig for AI fields**

In `getAppConfig` (around line 38), add to the return object:

```typescript
    aiEnhancementEnabled: data.ai_enhancement_enabled ?? false,
    aiEnhancementStyle: data.ai_enhancement_style ?? undefined,
```

In `saveAppConfig` (around line 57), add to the upsert row:

```typescript
        ai_enhancement_enabled: config.aiEnhancementEnabled ?? false,
        ai_enhancement_style: config.aiEnhancementStyle ?? null,
```

- [ ] **Step 5: Commit**

```bash
git add src/backend/dataService.ts
git commit -m "feat: add dataService CRUD for rules, filters, and enhanced content"
```

---

## Task 4: Filter Engine

**Files:**
- Create: `src/backend/filterEngine.ts`

- [ ] **Step 1: Create filterEngine.ts**

```typescript
// src/backend/filterEngine.ts

/**
 * Evaluates sync filters against Wix products.
 * Filters are destructive and sequential — a product excluded
 * by filter N cannot be re-included by filter N+1.
 */

import type { WixProduct } from '../types/wix.types';
import type { SyncFilter } from '../types/rules.types';
import type { Platform } from '../types/sync.types';

/**
 * Resolve a dot-path field value from a WixProduct.
 * Examples: "name", "inventory.availabilityStatus", "price.price"
 */
function resolveField(product: WixProduct, fieldPath: string): string | number | boolean | undefined {
  const parts = fieldPath.split('.');
  let current: unknown = product;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  if (current == null) return undefined;
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return current;
  }
  return String(current);
}

/** Check if a single filter condition matches a product. */
function matchesCondition(product: WixProduct, filter: SyncFilter): boolean {
  const fieldValue = resolveField(product, filter.field);
  const filterValue = filter.value;

  if (fieldValue === undefined) return false;

  const fieldStr = String(fieldValue);
  const fieldNum = Number(fieldValue);
  const filterNum = Number(filterValue);

  switch (filter.operator) {
    case 'equals':
      return fieldStr === filterValue;
    case 'not_equals':
      return fieldStr !== filterValue;
    case 'contains':
      return fieldStr.toLowerCase().includes(filterValue.toLowerCase());
    case 'greater_than':
      return !isNaN(fieldNum) && !isNaN(filterNum) && fieldNum > filterNum;
    case 'less_than':
      return !isNaN(fieldNum) && !isNaN(filterNum) && fieldNum < filterNum;
    default:
      return false;
  }
}

/**
 * Apply filters to a list of products.
 * Products matching the filter conditions are EXCLUDED.
 * Filters execute in order. Execution is destructive — once excluded, always excluded.
 *
 * AND group: ALL conditions in the group must match to exclude.
 * OR group: ANY condition match excludes.
 */
export function applyFilters(
  products: WixProduct[],
  filters: SyncFilter[],
  platform: Platform,
): WixProduct[] {
  const applicable = filters.filter(
    (f) => f.enabled && (f.platform === platform || f.platform === 'both'),
  );

  if (applicable.length === 0) return products;

  // Group filters by conditionGroup and order
  // Process sequentially: each filter removes products from the pool
  let remaining = [...products];

  // Group consecutive filters by conditionGroup
  let i = 0;
  while (i < applicable.length) {
    const group = applicable[i].conditionGroup;
    const groupFilters: SyncFilter[] = [];

    // Collect consecutive filters with same conditionGroup
    while (i < applicable.length && applicable[i].conditionGroup === group) {
      groupFilters.push(applicable[i]);
      i++;
    }

    if (group === 'AND') {
      // ALL conditions must match to exclude
      remaining = remaining.filter((product) => {
        const allMatch = groupFilters.every((f) => matchesCondition(product, f));
        return !allMatch; // keep product if NOT all conditions match
      });
    } else {
      // OR: ANY condition match excludes
      remaining = remaining.filter((product) => {
        const anyMatch = groupFilters.some((f) => matchesCondition(product, f));
        return !anyMatch; // keep product if NO conditions match
      });
    }
  }

  return remaining;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/filterEngine.ts
git commit -m "feat: add filter engine with dot-path field resolution and AND/OR groups"
```

---

## Task 5: Rules Engine

**Files:**
- Create: `src/backend/rulesEngine.ts`

- [ ] **Step 1: Create rulesEngine.ts**

```typescript
// src/backend/rulesEngine.ts

/**
 * Applies transformation rules to mapped product data.
 * Rules execute in order on each product.
 * Operates on GmcProductInput (post-mapping, pre-validation).
 */

import type { GmcProductInput, GmcProductAttributes } from '../types/gmc.types';
import type {
  SyncRule,
  ConcatenateExpression,
  StaticExpression,
  CalculatorExpression,
} from '../types/rules.types';
import type { Platform } from '../types/sync.types';

/** Read a field value from GmcProductAttributes by name. */
function readField(attrs: GmcProductAttributes, field: string): string {
  const value = (attrs as Record<string, unknown>)[field];
  if (value == null) return '';
  if (typeof value === 'object' && 'amountMicros' in (value as Record<string, unknown>)) {
    // Price field — return human-readable amount
    const micros = Number((value as { amountMicros: string }).amountMicros);
    return String(micros / 1_000_000);
  }
  return String(value);
}

/** Write a field value to GmcProductAttributes by name. */
function writeField(attrs: GmcProductAttributes, field: string, value: string): void {
  // Handle price fields specially
  if (field === 'price' || field === 'salePrice') {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      (attrs as Record<string, unknown>)[field] = {
        amountMicros: String(Math.round(num * 1_000_000)),
        currencyCode: attrs.price.currencyCode,
      };
    }
    return;
  }
  (attrs as Record<string, unknown>)[field] = value;
}

/** Apply a concatenate rule. */
function applyConcatenate(attrs: GmcProductAttributes, field: string, expr: ConcatenateExpression): void {
  const result = expr.parts
    .map((part) => {
      if (part.type === 'field') return readField(attrs, part.value);
      return part.value; // literal
    })
    .join('');

  writeField(attrs, field, result);
}

/** Apply a static rule. */
function applyStatic(attrs: GmcProductAttributes, field: string, expr: StaticExpression): void {
  writeField(attrs, field, expr.value);
}

/** Apply a calculator rule. */
function applyCalculator(attrs: GmcProductAttributes, field: string, expr: CalculatorExpression): void {
  const currentValue = parseFloat(readField(attrs, expr.field));
  if (isNaN(currentValue)) return;

  let result: number;
  switch (expr.operator) {
    case '+': result = currentValue + expr.operand; break;
    case '-': result = currentValue - expr.operand; break;
    case '*': result = currentValue * expr.operand; break;
    case '/': result = expr.operand !== 0 ? currentValue / expr.operand : currentValue; break;
    default: return;
  }

  writeField(attrs, field, String(result));
}

/** Apply a single rule to a product's attributes. */
function applyRule(attrs: GmcProductAttributes, rule: SyncRule): void {
  switch (rule.type) {
    case 'concatenate':
      applyConcatenate(attrs, rule.field, rule.expression as ConcatenateExpression);
      break;
    case 'static':
      applyStatic(attrs, rule.field, rule.expression as StaticExpression);
      break;
    case 'calculator':
      applyCalculator(attrs, rule.field, rule.expression as CalculatorExpression);
      break;
  }
}

/**
 * Apply all matching rules to a list of GMC products.
 * Rules execute in order on each product.
 */
export function applyRules(
  products: GmcProductInput[],
  rules: SyncRule[],
  platform: Platform,
): GmcProductInput[] {
  const applicable = rules.filter(
    (r) => r.enabled && (r.platform === platform || r.platform === 'both'),
  );

  if (applicable.length === 0) return products;

  for (const product of products) {
    for (const rule of applicable) {
      applyRule(product.productAttributes, rule);
    }
  }

  return products;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/rulesEngine.ts
git commit -m "feat: add rules engine with concatenate, static, and calculator support"
```

---

## Task 6: AI Enhancer

**Files:**
- Create: `src/backend/aiEnhancer.ts`

This task requires the `@anthropic-ai/sdk` package.

- [ ] **Step 1: Install Anthropic SDK**

```bash
cd /Users/curtismcewen/Documents/Git/SyncStream/sync-stream
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Create aiEnhancer.ts**

```typescript
// src/backend/aiEnhancer.ts

/**
 * AI-powered product description enhancement using Claude API.
 * Generates SEO/AEO-optimized descriptions, caches results
 * in Supabase enhanced_content table with source hash invalidation.
 */

import Anthropic from '@anthropic-ai/sdk';
import { secrets } from '@wix/secrets';
import type { WixProduct } from '../types/wix.types';
import type { EnhancedContent } from '../types/rules.types';
import {
  getEnhancedContent,
  getBulkEnhancedContent,
  saveEnhancedContent,
} from './dataService';

let _anthropicClient: Anthropic | null = null;

async function getAnthropicClient(): Promise<Anthropic> {
  if (_anthropicClient) return _anthropicClient;
  const apiKey = (await secrets.getSecretValue('anthropic_api_key')).value!;
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

/** Generate a SHA-256 hash of the product's source content for cache invalidation. */
export async function getSourceHash(product: WixProduct): Promise<string> {
  const content = [
    product.name ?? '',
    product.plainDescription ?? product.description ?? '',
    product.brand?.name ?? '',
  ].join('|');

  // Use Web Crypto API (available in Cloudflare Workers)
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the prompt for Claude to enhance a product description. */
function buildEnhancementPrompt(product: WixProduct, style?: string): string {
  const title = product.name ?? '';
  const description = product.plainDescription ?? product.description ?? '';
  const brand = product.brand?.name ?? '';
  const price = product.actualPriceRange?.minValue?.amount
    ?? product.priceData?.price
    ?? product.price?.price
    ?? '';

  return `You are a product content specialist. Enhance this product listing for Google Shopping and Meta Catalog feeds.

PRODUCT DATA:
- Title: ${title}
- Current Description: ${description || '(no description provided)'}
- Brand: ${brand || '(not specified)'}
- Price: ${price}

INSTRUCTIONS:
1. Write an SEO-optimized product description (150-300 words)
2. Include relevant keywords naturally — do NOT keyword-stuff
3. If the current description is thin or empty, generate a complete description from the title and available attributes
4. Structure for answer-engine optimization: lead with a clear product summary sentence, then key features, then use cases
5. Strip any promotional language ("Buy now!", "Free shipping!", "Add to cart")
6. Do NOT use all-caps (Meta rejects this)
7. Do NOT include pricing in the description
8. Write in third person
${style ? `9. Style/tone: ${style}` : ''}

Respond with ONLY a JSON object:
{"title": "optimized title (under 150 chars)", "description": "optimized description"}`;
}

/** Enhance a single product's content via Claude API. */
async function generateEnhancement(
  product: WixProduct,
  style?: string,
): Promise<{ title: string; description: string }> {
  const client = await getAnthropicClient();
  const prompt = buildEnhancementPrompt(product, style);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text);
    return {
      title: parsed.title ?? product.name,
      description: parsed.description ?? '',
    };
  } catch {
    // If JSON parse fails, use the raw text as description
    return {
      title: product.name,
      description: text.trim(),
    };
  }
}

/**
 * Enhance a single product. Uses cached content if source hash matches,
 * otherwise generates new content via Claude API.
 */
export async function enhanceProduct(
  product: WixProduct,
  instanceId: string,
  style?: string,
): Promise<{ title: string; description: string }> {
  const productId = product._id ?? product.id;
  const sourceHash = await getSourceHash(product);

  // Check cache
  const cached = await getEnhancedContent(instanceId, productId);
  if (cached && cached.sourceHash === sourceHash) {
    return {
      title: cached.enhancedTitle ?? product.name,
      description: cached.enhancedDescription,
    };
  }

  // Generate new enhancement
  const enhanced = await generateEnhancement(product, style);

  // Cache the result
  await saveEnhancedContent({
    instanceId,
    productId,
    platform: 'both',
    enhancedTitle: enhanced.title,
    enhancedDescription: enhanced.description,
    sourceHash,
    generatedAt: new Date().toISOString(),
  });

  return enhanced;
}

/**
 * Enhance multiple products. Fetches cached content in bulk,
 * only calls Claude API for products with stale or missing cache.
 * Returns a map of productId → enhanced content.
 */
export async function enhanceProducts(
  products: WixProduct[],
  instanceId: string,
  style?: string,
): Promise<Map<string, { title: string; description: string }>> {
  const productIds = products.map((p) => p._id ?? p.id);
  const cachedMap = await getBulkEnhancedContent(instanceId, productIds);
  const results = new Map<string, { title: string; description: string }>();

  for (const product of products) {
    const productId = product._id ?? product.id;
    const sourceHash = await getSourceHash(product);
    const cached = cachedMap.get(productId);

    if (cached && cached.sourceHash === sourceHash) {
      results.set(productId, {
        title: cached.enhancedTitle ?? product.name,
        description: cached.enhancedDescription,
      });
      continue;
    }

    // Generate new — sequential to respect API rate limits
    const enhanced = await generateEnhancement(product, style);

    await saveEnhancedContent({
      instanceId,
      productId,
      platform: 'both',
      enhancedTitle: enhanced.title,
      enhancedDescription: enhanced.description,
      sourceHash,
      generatedAt: new Date().toISOString(),
    });

    results.set(productId, enhanced);
  }

  return results;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/backend/aiEnhancer.ts package.json package-lock.json
git commit -m "feat: add AI enhancer with Claude API integration and source hash caching"
```

---

## Task 7: Refactor productMapper — Extract flattenVariants

**Files:**
- Modify: `src/backend/productMapper.ts`

The goal is to extract variant flattening into a standalone exported function so the sync pipeline can run filters on raw products, then flatten, then enhance, then map.

- [ ] **Step 1: Add FlattenedProduct type to wix.types.ts**

Add at the end of `src/types/wix.types.ts`:

```typescript
/** A product flattened to a single variant for pipeline processing.
 *  Multi-variant products produce one FlattenedProduct per variant. */
export interface FlattenedProduct {
  /** The parent WixProduct (full data). */
  product: WixProduct;
  /** The specific variant, if this is a multi-variant product. */
  variant?: WixVariant;
  /** Parent product ID (used as itemGroupId for multi-variant). */
  parentId: string;
  /** Unique ID for this specific item (variant ID or product ID). */
  itemId: string;
  /** Whether this product has multiple variants. */
  isMultiVariant: boolean;
}
```

- [ ] **Step 2: Add flattenVariants export to productMapper.ts**

Add this function before the existing `mapToGmc` function (before line 196):

```typescript
/**
 * Flatten a WixProduct into one FlattenedProduct per variant.
 * Single-variant products return one item.
 * Multi-variant products return one item per variant.
 */
export function flattenVariants(product: WixProduct): FlattenedProduct[] {
  const parentId = product._id ?? product.id;
  const variants = product.variantsInfo?.variants ?? [];

  if (variants.length <= 1) {
    return [{
      product,
      variant: variants[0],
      parentId,
      itemId: variants[0]?._id ?? variants[0]?.id ?? parentId,
      isMultiVariant: false,
    }];
  }

  return variants.map((variant) => ({
    product,
    variant,
    parentId,
    itemId: variant._id ?? variant.id,
    isMultiVariant: true,
  }));
}
```

Add the import for FlattenedProduct at the top:

```typescript
import type {
  WixProduct,
  WixVariant,
  FieldMappings,
  FlattenedProduct,
} from '../types/wix.types';
```

- [ ] **Step 3: Add mapFlattenedToGmc function**

Add after `flattenVariants`, before the existing `mapToGmc`:

```typescript
/**
 * Map a FlattenedProduct to a GmcProductInput.
 * This is the new entry point for the pipeline — works on pre-flattened items.
 * Enhanced title/description can be passed in to override the product's originals.
 */
export function mapFlattenedToGmc(
  item: FlattenedProduct,
  mappings: FieldMappings,
  siteUrl: string,
  enhanced?: { title?: string; description?: string },
): GmcProductInput {
  const { product, variant, isMultiVariant } = item;

  const rawDesc = enhanced?.description ?? product.plainDescription ?? product.description ?? '';
  const description = truncate(stripHtml(rawDesc), 5000) || product.name;
  const title = enhanced?.title ?? product.name;
  const brand =
    product.brand?.name ??
    resolveMappedField(product, 'brand', mappings) ??
    '';
  const condition = (
    resolveMappedField(product, 'condition', mappings)?.toUpperCase() as
      | GmcProductAttributes['condition']
      | undefined
  ) ?? 'NEW';
  const gtin = resolveMappedField(product, 'gtin', mappings);
  const mpn = resolveMappedField(product, 'mpn', mappings);
  const googleProductCategory = resolveMappedField(product, 'googleProductCategory', mappings);
  const additionalImageLinks = getAdditionalImageLinks(product);
  const price = extractPrice(product, variant);

  let availability: GmcProductAttributes['availability'];
  if (variant) {
    availability = variant.inventoryStatus?.inStock !== false ? 'IN_STOCK' : 'OUT_OF_STOCK';
  } else {
    availability = product.inventory?.availabilityStatus === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'IN_STOCK';
  }

  const productAttributes: GmcProductAttributes = {
    title,
    description,
    link: buildProductLink(product, siteUrl),
    imageLink: getImageLink(product, variant),
    availability,
    price,
    brand,
    condition,
  };

  if (isMultiVariant) {
    productAttributes.itemGroupId = item.parentId;
    const { color, size, material, pattern } = extractChoiceValues(variant!);
    if (color) productAttributes.color = color;
    if (size) productAttributes.size = size;
    // material and pattern added in extractChoiceValues update
  }

  if (gtin) productAttributes.gtins = [gtin];
  if (mpn) productAttributes.mpn = mpn;
  if (!gtin && !mpn) productAttributes.identifierExists = false;
  if (googleProductCategory) productAttributes.googleProductCategory = googleProductCategory;
  if (additionalImageLinks.length > 0) productAttributes.additionalImageLinks = additionalImageLinks;

  return {
    offerId: item.itemId,
    contentLanguage: 'en',
    feedLabel: 'US',
    productAttributes,
  };
}
```

- [ ] **Step 4: Update extractChoiceValues to include material and pattern**

Replace the existing `extractChoiceValues` function (lines 157-177):

```typescript
/** Extract color, size, material, and pattern from variant choices. */
function extractChoiceValues(variant: WixVariant): {
  color?: string;
  size?: string;
  material?: string;
  pattern?: string;
} {
  let color: string | undefined;
  let size: string | undefined;
  let material: string | undefined;
  let pattern: string | undefined;

  for (const choice of variant.choices) {
    const optionName =
      choice.optionChoiceNames?.optionName?.toLowerCase() ?? '';
    const choiceName = choice.optionChoiceNames?.choiceName;

    if (optionName.includes('color') && choiceName) {
      color = choiceName;
    } else if (optionName.includes('size') && choiceName) {
      size = choiceName;
    } else if (optionName.includes('material') && choiceName) {
      material = choiceName;
    } else if (optionName.includes('pattern') && choiceName) {
      pattern = choiceName;
    }
  }

  return { color, size, material, pattern };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/backend/productMapper.ts src/types/wix.types.ts
git commit -m "feat: extract flattenVariants and mapFlattenedToGmc, add material/pattern support"
```

---

## Task 8: Rewire syncService.ts Pipeline

**Files:**
- Modify: `src/backend/syncService.ts`

- [ ] **Step 1: Update imports**

Replace the existing imports (lines 1-27) with:

```typescript
/**
 * syncService.ts
 *
 * Central orchestrator for product sync operations.
 * Pipeline: fetch → filter → flatten → enhance → map → rules → validate → push → write state
 */

import type {
  BatchSyncResult,
  SyncOptions,
  SyncResult,
} from '../types/sync.types';
import type { WixProduct, SyncState } from '../types/wix.types';
import type { GmcProductInput, GmcInsertResult } from '../types/gmc.types';
import { flattenVariants, mapFlattenedToGmc, mapToGmc } from './productMapper';
import { validateGmc } from './validator';
import { batchInsertProducts } from './gmcClient';
import { applyFilters } from './filterEngine';
import { applyRules } from './rulesEngine';
import { enhanceProducts } from './aiEnhancer';
import {
  getValidGmcAccessToken,
  getGmcTokens,
} from './oauthService';
import {
  getAppConfig,
  bulkUpsertSyncStates,
  getRules,
  getFilters,
} from './dataService';
```

- [ ] **Step 2: Rewrite runFullSync with new pipeline**

Replace the `runFullSync` function (lines 119-231) with:

```typescript
export async function runFullSync(
  instanceId: string,
  options: SyncOptions,
): Promise<BatchSyncResult> {
  const config = await getAppConfig(instanceId);
  if (!config) {
    throw new Error('App not configured. Please complete setup first.');
  }

  // 1. Fetch products
  const allProducts = options.productIds
    ? await fetchProductsByIds(options.productIds)
    : await fetchAllProducts();

  const MAX_PRODUCTS_PER_SYNC = 5;
  const products = allProducts.slice(0, MAX_PRODUCTS_PER_SYNC);

  const results: SyncResult[] = [];

  if (options.platforms.includes('gmc')) {
    if (!config.gmcConnected) {
      throw new Error('GMC not connected. Please connect your account first.');
    }

    const accessToken = await getValidGmcAccessToken(instanceId);
    const tokens = await getGmcTokens(instanceId);
    const siteUrl = config.fieldMappings['siteUrl']?.defaultValue ?? '';

    // 2. Apply filters
    const filters = await getFilters(instanceId, 'gmc');
    const filtered = applyFilters(products, filters, 'gmc');

    // 3. Flatten variants
    const flattened = filtered.flatMap((p) => flattenVariants(p));

    // 4. AI enhance (if enabled)
    let enhancedMap: Map<string, { title: string; description: string }> | undefined;
    if (config.aiEnhancementEnabled) {
      // Enhance at product level (not variant level) to avoid duplicate API calls
      const uniqueProducts = [...new Map(filtered.map((p) => [p._id ?? p.id, p])).values()];
      enhancedMap = await enhanceProducts(uniqueProducts, instanceId, config.aiEnhancementStyle);
    }

    // 5. Map to GMC format + 6. Apply rules
    const rules = await getRules(instanceId, 'gmc');
    const validProducts: GmcProductInput[] = [];
    const validationFailures: SyncResult[] = [];

    for (const item of flattened) {
      const productId = item.product._id ?? item.product.id;
      const enhanced = enhancedMap?.get(productId);

      const gmcProduct = mapFlattenedToGmc(item, config.fieldMappings, siteUrl, enhanced);

      // 7. Validate (rules applied first)
      const transformed = applyRules([gmcProduct], rules, 'gmc');
      const errors = validateGmc(transformed[0], transformed[0].offerId);

      if (errors.length > 0) {
        validationFailures.push({
          productId: transformed[0].offerId,
          platform: 'gmc',
          success: false,
          errors,
        });
      } else {
        validProducts.push(transformed[0]);
      }
    }

    results.push(...validationFailures);

    // 8. Push valid products
    if (validProducts.length > 0) {
      const batchResults = await batchInsertProducts(
        tokens.merchantId,
        config.gmcDataSourceId ?? '',
        validProducts,
        accessToken,
      );

      for (const result of batchResults) {
        if (result.success) {
          results.push({
            productId: result.offerId,
            platform: 'gmc',
            success: true,
            externalId: result.name,
          });
        } else {
          results.push({
            productId: result.offerId,
            platform: 'gmc',
            success: false,
            errors: [{
              field: 'api',
              platform: 'gmc' as const,
              message: result.error ?? 'Unknown error',
              productId: result.offerId,
            }],
          });
        }
      }
    }
  }

  // 9. Write SyncState records
  const syncStates: SyncState[] = results.map((r) => ({
    productId: r.productId,
    platform: r.platform,
    status: r.success ? 'synced' as const : 'error' as const,
    lastSynced: new Date(),
    errorLog: r.errors ?? null,
    externalId: r.externalId ?? '',
  }));

  await bulkUpsertSyncStates(syncStates);

  const synced = results.filter((r) => r.success).length;
  return {
    total: results.length,
    synced,
    failed: results.length - synced,
    results,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/backend/syncService.ts
git commit -m "feat: rewire sync pipeline with filters, rules, and AI enhancement"
```

---

## Task 9: API Endpoints for Rules and Filters

**Files:**
- Create: `src/pages/api/rules.ts`
- Create: `src/pages/api/filters.ts`
- Create: `src/pages/api/enhance.ts`

- [ ] **Step 1: Check existing API endpoint pattern**

Read an existing endpoint to follow the pattern:

```bash
ls src/pages/api/
```

Read one of the existing endpoints to match the pattern (e.g., `src/pages/api/app-config.ts`).

- [ ] **Step 2: Create rules API endpoint**

Create `src/pages/api/rules.ts` following the existing API pattern. It should handle:
- `GET` — returns all rules for the instance
- `POST` — creates or updates a rule (upsert)
- `DELETE` — deletes a rule by ID (passed as query param `id`)

Use the same auth/instanceId extraction pattern as existing endpoints. Call `getAllRules`, `saveRule`, `deleteRule` from dataService.

- [ ] **Step 3: Create filters API endpoint**

Create `src/pages/api/filters.ts` following the same pattern. Handles:
- `GET` — returns all filters for the instance
- `POST` — creates or updates a filter
- `DELETE` — deletes a filter by ID

Call `getAllFilters`, `saveFilter`, `deleteFilter` from dataService.

- [ ] **Step 4: Create enhance API endpoint**

Create `src/pages/api/enhance.ts`:
- `POST` — triggers bulk AI enhancement for all products. Fetches products, calls `enhanceProducts`, returns count of enhanced.
- `GET` — returns enhancement status (count of enhanced_content records for instance).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/rules.ts src/pages/api/filters.ts src/pages/api/enhance.ts
git commit -m "feat: add API endpoints for rules, filters, and AI enhancement"
```

---

## Task 10: Dashboard — Rules & Filters Tabs on Mapping Page

**Files:**
- Modify: `src/extensions/dashboard/pages/mapping/mapping.tsx`

- [ ] **Step 1: Read current mapping.tsx**

Read the full file to understand the current component structure before modifying.

- [ ] **Step 2: Add Rules tab**

Add a tabbed layout to the mapping page using Wix Design System `Tabs` component. The existing field mapping becomes the first tab ("Field Mapping"). Add a "Rules" tab with:
- A list of existing rules showing: name, platform, field, type, enabled toggle
- "Add Rule" button that shows an inline form with: name, platform dropdown (gmc/meta/both), target field dropdown, rule type dropdown (concatenate/static/calculator), expression config (varies by type), order
- Delete button per rule
- Rules are fetched from `GET /api/rules` and saved via `POST /api/rules`

- [ ] **Step 3: Add Filters tab**

Add a "Filters" tab with:
- A list of existing filters showing: name, platform, field, operator, value, enabled toggle
- "Add Filter" button with inline form: name, platform dropdown, field (text input for dot-path), operator dropdown, value input, condition group (AND/OR), order
- Delete button per filter
- Filters are fetched from `GET /api/filters` and saved via `POST /api/filters`

- [ ] **Step 4: Commit**

```bash
git add src/extensions/dashboard/pages/mapping/mapping.tsx
git commit -m "feat: add Rules and Filters tabs to mapping dashboard page"
```

---

## Task 11: Dashboard — AI Enhancement on Settings Page

**Files:**
- Modify: `src/extensions/dashboard/pages/settings/settings.tsx`

- [ ] **Step 1: Read current settings.tsx**

Read the full file.

- [ ] **Step 2: Add AI Enhancement section**

Add a new section to the settings page below the existing content:
- Toggle for "AI Description Enhancement" (reads/writes `aiEnhancementEnabled` in AppConfig via existing `/api/app-config` endpoint)
- Text input for "Style/Tone" (optional, saves as `aiEnhancementStyle`)
- "Enhance All Descriptions" button that calls `POST /api/enhance`
- Status text showing count of enhanced products (from `GET /api/enhance`)

- [ ] **Step 3: Commit**

```bash
git add src/extensions/dashboard/pages/settings/settings.tsx
git commit -m "feat: add AI enhancement controls to settings dashboard page"
```

---

## Task 12: Store Anthropic API Key in Wix Secrets

- [ ] **Step 1: Document the required secret**

The AI enhancer reads from Wix Secrets Manager with key `anthropic_api_key`. This must be set by the developer (us) in the Wix dashboard under Secrets Manager before AI enhancement can work.

For the test environment, store the key via the Wix dashboard or CLI.

- [ ] **Step 2: Commit any documentation updates**

If CLAUDE.md needs updating with the new secret key name, update it.

```bash
git add CLAUDE.md
git commit -m "docs: document anthropic_api_key secret for AI enhancement"
```

---

## Task 13: Integration Verification

- [ ] **Step 1: Verify TypeScript compilation**

```bash
cd /Users/curtismcewen/Documents/Git/SyncStream/sync-stream
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Verify the build succeeds**

```bash
npm run build
```

Fix any build errors.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve compilation errors from GMC deep features integration"
```
