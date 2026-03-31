# GMC Deep Features: Rules, Filters, AI Enhancement

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Build rules engine, filter engine, and AI description enhancement on top of existing GMC sync pipeline. All features designed platform-aware (gmc|meta|both) so Meta plugs in later with zero retrofit.

---

## Execution Pipeline (Updated)

Current pipeline in syncService.ts:
```
fetch → map → validate → push → write state
```

New pipeline:
```
1. Fetch products from Wix SDK
2. Apply filters (remove excluded products)
3. Flatten variants into individual items
4. Apply AI enhancement (cached or inline generation)
5. Map to platform format (mapToGmc)
6. Apply field rules (transform mapped data)
7. Run validator
8. Push valid products to platform API
9. Write results to SyncState
```

Steps 2, 4, 6 are new. Variant flattening (step 3) moves out of mapToGmc() to run earlier so filters operate on flat items.

---

## Data Models

### SyncRule
```typescript
interface SyncRule {
  id: string;
  instanceId: string;
  name: string;
  platform: 'gmc' | 'meta' | 'both';
  field: string;
  type: 'concatenate' | 'static' | 'calculator';
  expression: ConcatenateExpression | StaticExpression | CalculatorExpression;
  order: number;
  enabled: boolean;
}

interface ConcatenateExpression {
  parts: Array<{ type: 'field'; value: string } | { type: 'literal'; value: string }>;
}

interface StaticExpression {
  value: string;
}

interface CalculatorExpression {
  field: string;
  operator: '+' | '-' | '*' | '/';
  operand: number;
}
```

### SyncFilter
```typescript
interface SyncFilter {
  id: string;
  instanceId: string;
  name: string;
  platform: 'gmc' | 'meta' | 'both';
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  value: string;
  conditionGroup: 'AND' | 'OR';
  order: number;
  enabled: boolean;
}
```

### EnhancedContent
```typescript
interface EnhancedContent {
  id: string;
  instanceId: string;
  productId: string;
  platform: 'gmc' | 'meta' | 'both';
  enhancedTitle?: string;
  enhancedDescription: string;
  sourceHash: string; // SHA-256 of title+description+brand+category
  generatedAt: string;
}
```

### AppConfig Additions
```typescript
// Added to existing AppConfig
aiEnhancementEnabled: boolean;       // default false
aiEnhancementStyle?: string;         // optional tone/style instructions
```

---

## Supabase Tables

### sync_rules
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| instance_id | text | NOT NULL |
| name | text | NOT NULL |
| platform | text | 'gmc' \| 'meta' \| 'both' |
| field | text | target field name |
| type | text | 'concatenate' \| 'static' \| 'calculator' |
| expression | jsonb | type-specific config |
| "order" | integer | execution order |
| enabled | boolean | default true |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### sync_filters
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| instance_id | text | NOT NULL |
| name | text | NOT NULL |
| platform | text | 'gmc' \| 'meta' \| 'both' |
| field | text | Wix product field path |
| operator | text | equals, not_equals, contains, greater_than, less_than |
| value | text | comparison value |
| condition_group | text | 'AND' \| 'OR' |
| "order" | integer | execution order |
| enabled | boolean | default true |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### enhanced_content
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| instance_id | text | NOT NULL |
| product_id | text | NOT NULL |
| platform | text | 'gmc' \| 'meta' \| 'both' |
| enhanced_title | text | nullable |
| enhanced_description | text | NOT NULL |
| source_hash | text | SHA-256 for cache invalidation |
| generated_at | timestamptz | default now() |

Unique constraint on (instance_id, product_id, platform) for enhanced_content.

---

## New Backend Files

### filterEngine.ts
Pure function. Takes WixProduct[] + SyncFilter[] + platform → returns filtered WixProduct[].
- Filters execute in order
- Sequential destructive: excluded by filter N cannot be re-included by filter N+1
- AND group: all conditions must match to EXCLUDE
- OR group: any condition match EXCLUDES
- Field access via dot-path on WixProduct (e.g., "stock.inStock", "price.price")

### rulesEngine.ts
Pure function. Takes GmcProductInput[] + SyncRule[] + platform → returns transformed GmcProductInput[].
- Rules execute in order on each product
- concatenate: joins parts (field references resolved from product, literals passed through)
- static: overwrites target field with fixed value
- calculator: applies arithmetic to numeric field
- Field references in concatenate use the GmcProductInput attribute names (title, description, brand, etc.)

### aiEnhancer.ts
- `enhanceProducts(products, instanceId, config)` — bulk enhancement
- `enhanceProduct(product, instanceId, config)` — single product
- `getSourceHash(product)` — SHA-256 of title+description+brand+category
- Checks enhanced_content cache by sourceHash. Cache hit → use cached. Cache miss → call Claude API.
- Claude API call: sends product attributes, receives optimized title + description
- Prompt covers: SEO rewrite, AEO enrichment, generate-from-scratch for thin descriptions
- Uses claude-haiku-4-5 for cost efficiency
- Enhanced content replaces original BEFORE rules execute (rules can further modify)

---

## API Endpoints (New)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/rules | GET | List rules for instance |
| /api/rules | POST | Create/update rule |
| /api/rules/:id | DELETE | Delete rule |
| /api/filters | GET | List filters for instance |
| /api/filters | POST | Create/update filter |
| /api/filters/:id | DELETE | Delete filter |
| /api/enhance | POST | Trigger bulk AI enhancement |
| /api/enhance/status | GET | Enhancement progress |

---

## Dashboard Changes

### Mapping Page — New Tabs
- **Rules tab**: list rules, add/edit/delete, drag-to-reorder, enable/disable toggle
- **Filters tab**: list filters, add/edit/delete, drag-to-reorder, enable/disable toggle

### Settings Page — New Section
- AI Enhancement toggle
- Style/tone text input (optional)
- "Enhance All Descriptions" button
- Enhancement status indicator

---

## Variant Flattening Refactor

Move variant flattening OUT of mapToGmc() into a standalone function in productMapper.ts:
- `flattenVariants(product: WixProduct): FlattenedProduct[]`
- Returns one FlattenedProduct per variant (or one for single-variant products)
- FlattenedProduct carries variant-specific: price, stock, images, color, size, material, pattern
- Also carries parent-level: title, description, brand, link, category
- mapToGmc() then takes FlattenedProduct instead of WixProduct

This lets filters and AI enhancement work on the flattened items.

---

## Execution Order Detail

```typescript
async function runFullSync(options: SyncOptions): Promise<BatchSyncResult> {
  // 1. Fetch
  const products = await fetchAllProducts();
  
  // 2. Filter
  const filters = await dataService.getFilters(instanceId, platform);
  const filtered = filterEngine.apply(products, filters, platform);
  
  // 3. Flatten variants
  const flattened = filtered.flatMap(p => flattenVariants(p));
  
  // 4. AI enhance
  if (config.aiEnhancementEnabled) {
    await aiEnhancer.enhanceProducts(flattened, instanceId, config);
    // enhanceProducts mutates flattened items with cached/new descriptions
  }
  
  // 5. Map to platform format
  const mapped = flattened.map(f => mapToGmc(f, fieldMappings));
  
  // 6. Apply rules
  const rules = await dataService.getRules(instanceId, platform);
  const transformed = rulesEngine.apply(mapped, rules, platform);
  
  // 7. Validate
  const { valid, invalid } = validate(transformed, platform);
  
  // 8. Push
  const results = await gmcClient.batchInsertProducts(valid);
  
  // 9. Write state
  await dataService.bulkUpsertSyncStates(results);
  
  return buildResult(results, invalid);
}
```
