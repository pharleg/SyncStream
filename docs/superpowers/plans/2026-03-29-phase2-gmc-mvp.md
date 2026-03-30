# Phase 2: GMC-Only MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working GMC-only MVP that connects a merchant's Google Merchant Center account via OAuth, fetches all Wix Store products, maps them to GMC format (including variant expansion), validates required fields, and pushes them via the Content API for Shopping v2.1.

**Architecture:** OAuth flow uses backend HTTP endpoints that redirect to Google, exchange codes for tokens, and store them in Wix Secrets Manager. `syncService` orchestrates: fetch all products via Wix SDK → expand variants → map each to GMC format via `productMapper` → validate via `validator` → push valid products via `gmcClient` custombatch → write results to SyncState collection. The Connect dashboard page provides the OAuth trigger and shows connection status.

**Tech Stack:** Wix CLI (React + TypeScript), `@wix/stores` SDK (`catalogV3`), Google Content API for Shopping v2.1 (REST), `@wix/design-system` for UI, Wix Secrets Manager, Wix Data collections.

**Reference implementation:** https://github.com/pharleg/lecc-google-merchant-feed — validated Wix API patterns, price fallback chain, variant resolution logic.

---

## File Map

| File | Responsibility | Action |
|------|---------------|--------|
| `src/types/wix.types.ts` | Wix product types including variants, options, price paths | Modify |
| `src/types/gmc.types.ts` | GMC product, batch request/response, OAuth config types | Modify |
| `src/types/sync.types.ts` | Sync result and batch types (no changes needed for Phase 2) | Unchanged |
| `src/backend/oauthService.ts` | GMC OAuth URL generation, code exchange, token storage/retrieval | Implement |
| `src/backend/productMapper.ts` | Wix→GMC field mapping, variant expansion, price fallback, HTML strip | Implement |
| `src/backend/validator.ts` | GMC required-field validation with structured errors | Implement |
| `src/backend/gmcClient.ts` | Content API v2.1 insert/delete, custombatch, token refresh | Implement |
| `src/backend/syncService.ts` | Full sync orchestrator: fetch→map→validate→push→record | Implement |
| `src/extensions/dashboard/pages/connect/connect.tsx` | OAuth trigger UI, connection status display | Implement |
| `src/backend/dataService.ts` | CRUD helpers for AppConfig and SyncState Wix Data collections | Create |

---

### Task 1: Expand Type Definitions

**Files:**
- Modify: `src/types/wix.types.ts`
- Modify: `src/types/gmc.types.ts`
- Create: `src/backend/dataService.ts`

- [ ] **Step 1: Update WixProduct type to match V3 SDK response**

Replace the entire `WixProduct` interface and add variant/option types in `src/types/wix.types.ts`:

```typescript
/** Price as returned by Wix V3 SDK. */
export interface WixPrice {
  amount: string;
  formattedAmount?: string;
}

/** Range of prices across variants. */
export interface WixPriceRange {
  minValue?: WixPrice;
  maxValue?: WixPrice;
}

/** A single option choice (e.g. "Red", "Large"). */
export interface WixOptionChoice {
  name: string;
  choiceId?: string;
  inStock?: boolean;
  visible?: boolean;
}

/** A product option (e.g. "Color", "Size"). */
export interface WixProductOption {
  id: string;
  name: string;
  optionRenderType?: string;
  choicesSettings?: {
    choices: WixOptionChoice[];
  };
}

/** Variant choice reference linking optionId+choiceId to names. */
export interface WixVariantChoice {
  optionChoiceIds?: { optionId: string; choiceId: string };
  optionChoiceNames?: { optionName: string; choiceName: string };
}

/** A single product variant. */
export interface WixVariant {
  id: string;
  visible?: boolean;
  sku?: string;
  barcode?: string;
  choices: WixVariantChoice[];
  price?: {
    actualPrice?: WixPrice;
    compareAtPrice?: WixPrice;
  };
  inventoryStatus?: { inStock: boolean };
  media?: { mainMedia?: { image?: { url: string } } };
}

/** Media item in the product media gallery. */
export interface WixMediaItem {
  image?: { url: string; altText?: string };
  mediaType?: string;
}

/** Wix product as returned by the Stores V3 SDK. */
export interface WixProduct {
  id: string;
  name: string;
  slug: string;
  description?: string;
  plainDescription?: string;
  url?: { relativePath?: string; url?: string };
  brand?: { id?: string; name?: string };
  media?: {
    main?: { image?: { url: string }; thumbnail?: { url: string } };
    itemsInfo?: { items?: WixMediaItem[] };
  };
  inventory?: {
    availabilityStatus?: 'IN_STOCK' | 'OUT_OF_STOCK' | 'PARTIALLY_OUT_OF_STOCK';
  };
  actualPriceRange?: WixPriceRange;
  compareAtPriceRange?: WixPriceRange;
  currency?: string;
  options?: WixProductOption[];
  variantsInfo?: { variants: WixVariant[] };
  variantSummary?: { variantCount: number };
  extendedFields?: { namespaces?: Record<string, Record<string, unknown>> };
  customFields?: Record<string, string>;
  productType?: 'PHYSICAL' | 'DIGITAL';
  visible?: boolean;
  /** Legacy price paths (V1/V2 compat). */
  priceData?: { price?: number | string; currency?: string };
  price?: { price?: number | string; currency?: string };
}
```

Keep `AppConfig`, `FieldMapping`, `FieldMappings`, `SyncState`, and `ValidationError` unchanged — they are correct.

- [ ] **Step 2: Add GMC batch and OAuth config types**

Add to the end of `src/types/gmc.types.ts`:

```typescript
/** Configuration for GMC OAuth (loaded from environment/secrets). */
export interface GmcOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

/** A single entry in a custombatch request. */
export interface GmcBatchEntry {
  batchId: number;
  merchantId: string;
  method: 'insert' | 'get' | 'delete';
  product?: GmcProduct & {
    contentLanguage: string;
    targetCountry: string;
    channel: string;
    itemGroupId?: string;
    additionalImageLinks?: string[];
    color?: string;
    sizes?: string[];
    ageGroup?: string;
    gender?: string;
    googleProductCategory?: string;
  };
  productId?: string; // REST ID for get/delete: "online:en:US:{offerId}"
}

/** Response from custombatch. */
export interface GmcBatchResponse {
  entries: GmcBatchResponseEntry[];
}

export interface GmcBatchResponseEntry {
  batchId: number;
  product?: { id: string; offerId: string };
  errors?: {
    errors: GmcError[];
    code: number;
    message: string;
  };
}
```

- [ ] **Step 3: Add expanded GmcProduct fields**

Update the `GmcProduct` interface in `src/types/gmc.types.ts` to include all fields we'll push:

```typescript
/** Product entry for the Google Content API for Shopping v2.1. */
export interface GmcProduct {
  offerId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  availability: 'in_stock' | 'out_of_stock';
  price: { value: string; currency: string };
  brand: string;
  gtin?: string;
  mpn?: string;
  condition: 'new' | 'refurbished' | 'used';
  contentLanguage: string;
  targetCountry: string;
  channel: string;
  itemGroupId?: string;
  additionalImageLinks?: string[];
  color?: string;
  sizes?: string[];
  ageGroup?: string;
  gender?: string;
  googleProductCategory?: string;
  salePrice?: { value: string; currency: string };
  identifierExists?: boolean;
}
```

- [ ] **Step 4: Create dataService.ts for Wix Data collection CRUD**

Create `src/backend/dataService.ts`:

```typescript
/**
 * dataService.ts
 *
 * CRUD helpers for AppConfig and SyncState Wix Data collections.
 * All Wix Data access is centralized here.
 */

import type { AppConfig, SyncState } from '../types/wix.types';

const COLLECTION_APP_CONFIG = 'AppConfig';
const COLLECTION_SYNC_STATE = 'SyncState';

export async function getAppConfig(
  instanceId: string,
): Promise<AppConfig | null> {
  // TODO: implement with Wix Data SDK
  // wixData.query(COLLECTION_APP_CONFIG).eq('instanceId', instanceId).find()
  throw new Error('Not implemented');
}

export async function saveAppConfig(
  config: AppConfig,
): Promise<void> {
  // TODO: implement with Wix Data SDK
  // wixData.save(COLLECTION_APP_CONFIG, config) or wixData.update(...)
  throw new Error('Not implemented');
}

export async function getSyncState(
  productId: string,
  platform: 'gmc' | 'meta',
): Promise<SyncState | null> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}

export async function upsertSyncState(
  state: SyncState,
): Promise<void> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}

export async function bulkUpsertSyncStates(
  states: SyncState[],
): Promise<void> {
  // TODO: implement with Wix Data SDK
  throw new Error('Not implemented');
}
```

- [ ] **Step 5: Commit**

```bash
git add src/types/wix.types.ts src/types/gmc.types.ts src/types/sync.types.ts src/backend/dataService.ts
git commit -m "feat: expand types for Wix V3 variants, GMC batch, and data service stub"
```

---

### Task 2: Implement GMC OAuth Service

**Files:**
- Modify: `src/backend/oauthService.ts`

**Docs reference:**
- Google OAuth2: Authorization URL `https://accounts.google.com/o/oauth2/v2/auth`
- Token exchange/refresh: `https://oauth2.googleapis.com/token`
- Scope: `https://www.googleapis.com/auth/content`
- Wix Secrets Manager: store tokens under namespaced keys

- [ ] **Step 1: Implement initiateGmcOAuth**

Replace `src/backend/oauthService.ts` with:

```typescript
/**
 * oauthService.ts
 *
 * Handles OAuth flows for GMC and Meta.
 * Exchanges auth codes for tokens, stores them in Wix Secrets Manager.
 * Keys: gmc_access_token_{instanceId}, gmc_refresh_token_{instanceId},
 *        meta_access_token_{instanceId}, meta_refresh_token_{instanceId}
 */

import { secrets } from '@wix/essentials';
import type { GmcTokens } from '../types/gmc.types';

const GMC_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMC_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMC_SCOPE = 'https://www.googleapis.com/auth/content';

async function getGmcClientCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}> {
  const clientId = await secrets.getSecret('gmc_client_id');
  const clientSecret = await secrets.getSecret('gmc_client_secret');
  const redirectUri = await secrets.getSecret('gmc_redirect_uri');
  return { clientId, clientSecret, redirectUri };
}

export async function initiateGmcOAuth(
  instanceId: string,
): Promise<string> {
  const { clientId, redirectUri } = await getGmcClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMC_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: instanceId,
  });
  return `${GMC_AUTH_URL}?${params.toString()}`;
}

export async function handleGmcCallback(
  instanceId: string,
  code: string,
): Promise<void> {
  const { clientId, clientSecret, redirectUri } =
    await getGmcClientCredentials();

  const response = await fetch(GMC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GMC token exchange failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  await secrets.createOrUpdateSecret(
    `gmc_access_token_${instanceId}`,
    data.access_token,
  );
  await secrets.createOrUpdateSecret(
    `gmc_refresh_token_${instanceId}`,
    data.refresh_token,
  );
  await secrets.createOrUpdateSecret(
    `gmc_token_expiry_${instanceId}`,
    String(Date.now() + data.expires_in * 1000),
  );
}

export async function getGmcTokens(
  instanceId: string,
): Promise<GmcTokens> {
  const [accessToken, refreshToken, expiresAtStr, merchantId] =
    await Promise.all([
      secrets.getSecret(`gmc_access_token_${instanceId}`),
      secrets.getSecret(`gmc_refresh_token_${instanceId}`),
      secrets.getSecret(`gmc_token_expiry_${instanceId}`),
      secrets.getSecret(`gmc_merchant_id_${instanceId}`),
    ]);

  return {
    accessToken,
    refreshToken,
    expiresAt: Number(expiresAtStr),
    merchantId,
  };
}

export async function refreshGmcTokens(
  instanceId: string,
): Promise<string> {
  const { clientId, clientSecret } = await getGmcClientCredentials();
  const refreshToken = await secrets.getSecret(
    `gmc_refresh_token_${instanceId}`,
  );

  const response = await fetch(GMC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GMC token refresh failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  await secrets.createOrUpdateSecret(
    `gmc_access_token_${instanceId}`,
    data.access_token,
  );
  await secrets.createOrUpdateSecret(
    `gmc_token_expiry_${instanceId}`,
    String(Date.now() + data.expires_in * 1000),
  );

  return data.access_token;
}

/** Get a valid access token, refreshing if expired. */
export async function getValidGmcAccessToken(
  instanceId: string,
): Promise<string> {
  const tokens = await getGmcTokens(instanceId);
  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens.accessToken;
  }
  return refreshGmcTokens(instanceId);
}

export async function initiateMetaOAuth(
  _instanceId: string,
): Promise<string> {
  // TODO Phase 4: return OAuth URL
  throw new Error('Not implemented');
}

export async function handleMetaCallback(
  _instanceId: string,
  _code: string,
): Promise<void> {
  // TODO Phase 4: exchange code, store tokens
  throw new Error('Not implemented');
}
```

- [ ] **Step 2: Verify the `@wix/essentials` secrets import works**

Check that `@wix/essentials` is in package.json dependencies (it is: `"@wix/essentials": "^0.1.23"`). The `secrets` module provides `getSecret` and `createOrUpdateSecret`.

- [ ] **Step 3: Commit**

```bash
git add src/backend/oauthService.ts
git commit -m "feat: implement GMC OAuth flow with token storage in Secrets Manager"
```

---

### Task 3: Implement Product Mapper (GMC)

**Files:**
- Modify: `src/backend/productMapper.ts`

**Key logic from LECC reference:**
- Price fallback chain: `actualPriceRange.minValue.amount` → `priceData.price` → `price.price`
- Per-variant price override: `variant.price.actualPrice.amount`
- Variant expansion: one GMC row per variant, with `itemGroupId = product.id` for multi-variant products
- Color/size from variant choices, resolved by option name containing "color" or "size"
- HTML strip via regex
- Description truncated to 5000 chars
- Additional images: up to 10, excluding main image

- [ ] **Step 1: Implement helper functions**

Replace `src/backend/productMapper.ts` with:

```typescript
/**
 * productMapper.ts
 *
 * Transforms Wix products into GMC and Meta product formats
 * using the merchant's field mappings from AppConfig.
 */

import type {
  WixProduct,
  WixVariant,
  FieldMappings,
} from '../types/wix.types';
import type { GmcProduct } from '../types/gmc.types';
import type { MetaProduct } from '../types/meta.types';

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncate string to maxLen characters. */
function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

/**
 * Extract price from a Wix product using the fallback chain.
 * Returns { value: "14.99", currency: "USD" }.
 */
function extractPrice(
  product: WixProduct,
  variant?: WixVariant,
): { value: string; currency: string } {
  const currency = product.currency ?? 'USD';

  // Variant-level price override
  if (variant?.price?.actualPrice?.amount) {
    return { value: variant.price.actualPrice.amount, currency };
  }

  // Fallback 1: actualPriceRange.minValue.amount
  if (product.actualPriceRange?.minValue?.amount) {
    return { value: product.actualPriceRange.minValue.amount, currency };
  }

  // Fallback 2: priceData.price
  if (product.priceData?.price != null) {
    return { value: String(product.priceData.price), currency };
  }

  // Fallback 3: price.price
  if (product.price?.price != null) {
    return { value: String(product.price.price), currency };
  }

  return { value: '0.00', currency };
}

/** Resolve a mapped field value from product data. */
function resolveMappedField(
  product: WixProduct,
  fieldName: string,
  mappings: FieldMappings,
): string | undefined {
  const mapping = mappings[fieldName];
  if (!mapping) return undefined;

  if (mapping.type === 'default') {
    return mapping.defaultValue;
  }

  if (mapping.type === 'customField' && mapping.wixField) {
    // Try extendedFields first, then legacy customFields
    const extVal =
      product.extendedFields?.namespaces?.['@wix/stores']?.[
        mapping.wixField
      ];
    if (typeof extVal === 'string') return extVal;

    return product.customFields?.[mapping.wixField];
  }

  return undefined;
}

/** Get the main image URL from a product or variant. */
function getImageLink(
  product: WixProduct,
  variant?: WixVariant,
): string {
  return (
    variant?.media?.mainMedia?.image?.url ??
    product.media?.main?.image?.url ??
    ''
  );
}

/** Get additional image URLs (up to 10, excluding main). */
function getAdditionalImageLinks(product: WixProduct): string[] {
  const mainUrl = product.media?.main?.image?.url;
  const items = product.media?.itemsInfo?.items ?? [];
  return items
    .filter((item) => item.image?.url && item.image.url !== mainUrl)
    .map((item) => item.image!.url)
    .slice(0, 10);
}

/** Extract color and size from variant choices. */
function extractChoiceValues(variant: WixVariant): {
  color?: string;
  size?: string;
} {
  let color: string | undefined;
  let size: string | undefined;

  for (const choice of variant.choices) {
    const optionName =
      choice.optionChoiceNames?.optionName?.toLowerCase() ?? '';
    const choiceName = choice.optionChoiceNames?.choiceName;

    if (optionName.includes('color') && choiceName) {
      color = choiceName;
    } else if (optionName.includes('size') && choiceName) {
      size = choiceName;
    }
  }

  return { color, size };
}

/** Build the product page URL. */
function buildProductLink(product: WixProduct, siteUrl: string): string {
  if (product.url?.url) return product.url.url;
  const path = product.url?.relativePath ?? `/product-page/${product.slug}`;
  return `${siteUrl}${path}`;
}

/**
 * Map a Wix product to one or more GMC products.
 * Multi-variant products expand to one GMC row per variant.
 */
export function mapToGmc(
  product: WixProduct,
  mappings: FieldMappings,
  siteUrl: string,
): GmcProduct[] {
  const rawDesc = product.plainDescription ?? product.description ?? '';
  const description = truncate(stripHtml(rawDesc), 5000) || product.name;
  const brand =
    product.brand?.name ??
    resolveMappedField(product, 'brand', mappings) ??
    '';
  const condition =
    (resolveMappedField(product, 'condition', mappings) as
      | GmcProduct['condition']
      | undefined) ?? 'new';
  const gtin = resolveMappedField(product, 'gtin', mappings);
  const mpn = resolveMappedField(product, 'mpn', mappings);
  const googleProductCategory = resolveMappedField(
    product,
    'googleProductCategory',
    mappings,
  );
  const additionalImageLinks = getAdditionalImageLinks(product);

  const variants = product.variantsInfo?.variants ?? [];
  const isMultiVariant = variants.length > 1;

  // Single product (no variants or single variant)
  if (variants.length <= 1) {
    const variant = variants[0];
    const price = extractPrice(product, variant);
    const availability: GmcProduct['availability'] =
      product.inventory?.availabilityStatus === 'OUT_OF_STOCK'
        ? 'out_of_stock'
        : 'in_stock';

    const gmcProduct: GmcProduct = {
      offerId: variant?.id ?? product.id,
      title: product.name,
      description,
      link: buildProductLink(product, siteUrl),
      imageLink: getImageLink(product, variant),
      availability,
      price,
      brand,
      condition,
      contentLanguage: 'en',
      targetCountry: 'US',
      channel: 'online',
    };

    if (gtin) gmcProduct.gtin = gtin;
    if (mpn) gmcProduct.mpn = mpn;
    if (!gtin && !mpn) gmcProduct.identifierExists = false;
    if (googleProductCategory)
      gmcProduct.googleProductCategory = googleProductCategory;
    if (additionalImageLinks.length > 0)
      gmcProduct.additionalImageLinks = additionalImageLinks;

    return [gmcProduct];
  }

  // Multi-variant: one GMC row per variant
  return variants.map((variant) => {
    const price = extractPrice(product, variant);
    const { color, size } = extractChoiceValues(variant);
    const inStock = variant.inventoryStatus?.inStock !== false;

    const gmcProduct: GmcProduct = {
      offerId: variant.id,
      title: product.name,
      description,
      link: buildProductLink(product, siteUrl),
      imageLink: getImageLink(product, variant),
      availability: inStock ? 'in_stock' : 'out_of_stock',
      price,
      brand,
      condition,
      contentLanguage: 'en',
      targetCountry: 'US',
      channel: 'online',
      itemGroupId: product.id,
    };

    if (color) gmcProduct.color = color;
    if (size) gmcProduct.sizes = [size];
    if (gtin) gmcProduct.gtin = gtin;
    if (mpn) gmcProduct.mpn = mpn;
    if (!gtin && !mpn) gmcProduct.identifierExists = false;
    if (googleProductCategory)
      gmcProduct.googleProductCategory = googleProductCategory;
    if (additionalImageLinks.length > 0)
      gmcProduct.additionalImageLinks = additionalImageLinks;

    return gmcProduct;
  });
}

export function mapToMeta(
  _product: WixProduct,
  _mappings: FieldMappings,
  _siteUrl: string,
): MetaProduct {
  // TODO Phase 4: implement Meta mapping
  throw new Error('Not implemented');
}
```

Note: `mapToGmc` now returns `GmcProduct[]` (array) instead of a single product, to handle variant expansion. Update the import in `syncService.ts` accordingly.

- [ ] **Step 2: Commit**

```bash
git add src/backend/productMapper.ts
git commit -m "feat: implement GMC product mapper with variant expansion and price fallback"
```

---

### Task 4: Implement GMC Validator

**Files:**
- Modify: `src/backend/validator.ts`

**Rules from CLAUDE.md:**
- Required fields: offerId, title, description, link, imageLink, availability, price, brand, condition
- Either gtin or mpn required (unless identifierExists=false)
- Price value must be > 0
- Description max 5000 chars
- Structured error: `{ field, platform, message, productId }`
- Batch does NOT abort for one bad product

- [ ] **Step 1: Implement validateGmc**

Replace `src/backend/validator.ts` with:

```typescript
/**
 * validator.ts
 *
 * Validates products against GMC / Meta required-field rules
 * before any push. Returns structured errors per product.
 * A batch does NOT abort for one bad product.
 */

import type { ValidationError } from '../types/wix.types';
import type { GmcProduct } from '../types/gmc.types';
import type { MetaProduct } from '../types/meta.types';

function requiredString(
  value: string | undefined,
  field: string,
  productId: string,
): ValidationError | null {
  if (!value || value.trim().length === 0) {
    return {
      field,
      platform: 'gmc',
      message: `${field} is required and must not be empty`,
      productId,
    };
  }
  return null;
}

export function validateGmc(
  product: GmcProduct,
  productId: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required string fields
  const requiredFields: (keyof GmcProduct)[] = [
    'offerId',
    'title',
    'description',
    'link',
    'imageLink',
    'brand',
  ];

  for (const field of requiredFields) {
    const err = requiredString(
      product[field] as string | undefined,
      field,
      productId,
    );
    if (err) errors.push(err);
  }

  // Availability must be valid
  if (!['in_stock', 'out_of_stock'].includes(product.availability)) {
    errors.push({
      field: 'availability',
      platform: 'gmc',
      message: `availability must be "in_stock" or "out_of_stock", got "${product.availability}"`,
      productId,
    });
  }

  // Condition must be valid
  if (!['new', 'refurbished', 'used'].includes(product.condition)) {
    errors.push({
      field: 'condition',
      platform: 'gmc',
      message: `condition must be "new", "refurbished", or "used", got "${product.condition}"`,
      productId,
    });
  }

  // Price must be > 0
  const priceVal = parseFloat(product.price?.value ?? '0');
  if (isNaN(priceVal) || priceVal <= 0) {
    errors.push({
      field: 'price',
      platform: 'gmc',
      message: `price must be greater than 0, got "${product.price?.value}"`,
      productId,
    });
  }

  // Price currency required
  if (!product.price?.currency) {
    errors.push({
      field: 'price.currency',
      platform: 'gmc',
      message: 'price currency is required',
      productId,
    });
  }

  // Description max 5000 chars
  if (product.description && product.description.length > 5000) {
    errors.push({
      field: 'description',
      platform: 'gmc',
      message: `description exceeds 5000 character limit (${product.description.length} chars)`,
      productId,
    });
  }

  // Link must be a valid URL
  if (product.link && !product.link.startsWith('http')) {
    errors.push({
      field: 'link',
      platform: 'gmc',
      message: 'link must be a valid URL starting with http',
      productId,
    });
  }

  // Image link must be a valid URL
  if (product.imageLink && !product.imageLink.startsWith('http')) {
    errors.push({
      field: 'imageLink',
      platform: 'gmc',
      message: 'imageLink must be a valid URL starting with http',
      productId,
    });
  }

  return errors;
}

export function validateMeta(
  _product: MetaProduct,
  _productId: string,
): ValidationError[] {
  // TODO Phase 4: implement Meta validation
  return [];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/validator.ts
git commit -m "feat: implement GMC validator with required-field and format checks"
```

---

### Task 5: Implement GMC Client

**Files:**
- Modify: `src/backend/gmcClient.ts`

**API reference:**
- Base URL: `https://shoppingcontent.googleapis.com/content/v2.1`
- Insert: `POST /{merchantId}/products`
- Delete: `DELETE /{merchantId}/products/{productId}`
- Custombatch: `POST /products/batch`
- Product REST ID format: `online:en:US:{offerId}`

- [ ] **Step 1: Implement gmcClient.ts**

Replace `src/backend/gmcClient.ts` with:

```typescript
/**
 * gmcClient.ts
 *
 * All Google Content API for Shopping v2.1 calls live here.
 * No direct fetch calls to GMC should exist elsewhere.
 */

import type {
  GmcProduct,
  GmcInsertResponse,
  GmcBatchEntry,
  GmcBatchResponse,
  GmcBatchResponseEntry,
} from '../types/gmc.types';

const GMC_BASE_URL =
  'https://shoppingcontent.googleapis.com/content/v2.1';

async function gmcFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GMC_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `GMC API error ${response.status}: ${errorBody}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function insertProduct(
  merchantId: string,
  product: GmcProduct,
  accessToken: string,
): Promise<GmcInsertResponse> {
  return gmcFetch<GmcInsertResponse>(
    `/${merchantId}/products`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(product),
    },
  );
}

export async function deleteProduct(
  merchantId: string,
  offerId: string,
  accessToken: string,
): Promise<void> {
  const restId = `online:en:US:${offerId}`;
  await gmcFetch<void>(
    `/${merchantId}/products/${encodeURIComponent(restId)}`,
    accessToken,
    { method: 'DELETE' },
  );
}

/**
 * Push products in bulk via custombatch.
 * Batches are limited to 10,000 entries per Google's limits,
 * but we cap at 1,000 per call for reliability.
 */
export async function batchInsertProducts(
  merchantId: string,
  products: GmcProduct[],
  accessToken: string,
): Promise<GmcBatchResponseEntry[]> {
  const BATCH_SIZE = 1000;
  const allResults: GmcBatchResponseEntry[] = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const slice = products.slice(i, i + BATCH_SIZE);
    const entries: GmcBatchEntry[] = slice.map(
      (product, idx) => ({
        batchId: i + idx,
        merchantId,
        method: 'insert' as const,
        product: {
          ...product,
          contentLanguage:
            product.contentLanguage ?? 'en',
          targetCountry: product.targetCountry ?? 'US',
          channel: product.channel ?? 'online',
        },
      }),
    );

    const response = await gmcFetch<GmcBatchResponse>(
      '/products/batch',
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ entries }),
      },
    );

    allResults.push(...response.entries);
  }

  return allResults;
}

export async function refreshAccessToken(
  _refreshToken: string,
): Promise<string> {
  // Moved to oauthService.ts — use getValidGmcAccessToken() instead
  throw new Error(
    'Use oauthService.getValidGmcAccessToken() instead',
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/gmcClient.ts
git commit -m "feat: implement GMC client with insert, delete, and custombatch"
```

---

### Task 6: Implement Sync Service (Full Sync Orchestrator)

**Files:**
- Modify: `src/backend/syncService.ts`

**Architecture rules:**
- syncService is the ONLY orchestrator
- It calls productMapper, validator, gmcClient
- All sync ops must be idempotent
- Dashboard pages call this via backend functions only

- [ ] **Step 1: Implement syncService.ts**

Replace `src/backend/syncService.ts` with:

```typescript
/**
 * syncService.ts
 *
 * Central orchestrator for product sync operations.
 * Calls productMapper, validator, gmcClient, and metaClient.
 * Nothing else should call those modules directly.
 */

import type {
  BatchSyncResult,
  SyncOptions,
  SyncResult,
} from '../types/sync.types';
import type { WixProduct, SyncState } from '../types/wix.types';
import type { GmcProduct, GmcBatchResponseEntry } from '../types/gmc.types';
import { mapToGmc } from './productMapper';
import { validateGmc } from './validator';
import { batchInsertProducts } from './gmcClient';
import {
  getValidGmcAccessToken,
  getGmcTokens,
} from './oauthService';
import {
  getAppConfig,
  bulkUpsertSyncStates,
} from './dataService';

/**
 * Fetch all products from the Wix store.
 * Uses the Wix SDK catalogV3 API with cursor pagination.
 * Each product requires a second getProduct call for variant data.
 */
async function fetchAllProducts(): Promise<WixProduct[]> {
  // Dynamic import to avoid issues in non-Wix runtime contexts
  const { catalogV3 } = await import('@wix/stores');
  const products: WixProduct[] = [];
  let cursor: string | undefined;

  do {
    const response = await catalogV3.CatalogApi.queryProducts(
      {
        cursorPaging: { limit: 100, cursor },
      },
      {
        fields: [
          'URL',
          'CURRENCY',
          'PLAIN_DESCRIPTION',
          'MEDIA_ITEMS_INFO',
        ],
      },
    );

    // queryProducts doesn't return variantsInfo — fetch each product individually
    const productIds = (response.products ?? []).map((p: any) => p.id);
    for (const id of productIds) {
      const fullProduct = await catalogV3.CatalogApi.getProduct(
        id,
        {
          fields: [
            'URL',
            'CURRENCY',
            'PLAIN_DESCRIPTION',
            'MEDIA_ITEMS_INFO',
            'VARIANT_OPTION_CHOICE_NAMES',
          ],
        },
      );
      if (fullProduct) {
        products.push(fullProduct as unknown as WixProduct);
      }
    }

    cursor =
      (response.pagingMetadata as any)?.cursors?.next ?? undefined;
  } while (cursor);

  return products;
}

async function fetchProductsByIds(
  productIds: string[],
): Promise<WixProduct[]> {
  const { catalogV3 } = await import('@wix/stores');
  const products: WixProduct[] = [];

  for (const id of productIds) {
    const product = await catalogV3.CatalogApi.getProduct(id, {
      fields: [
        'URL',
        'CURRENCY',
        'PLAIN_DESCRIPTION',
        'MEDIA_ITEMS_INFO',
        'VARIANT_OPTION_CHOICE_NAMES',
      ],
    });
    if (product) {
      products.push(product as unknown as WixProduct);
    }
  }

  return products;
}

export async function runFullSync(
  instanceId: string,
  options: SyncOptions,
): Promise<BatchSyncResult> {
  const config = await getAppConfig(instanceId);
  if (!config) {
    throw new Error('App not configured. Please complete setup first.');
  }

  const products = options.productIds
    ? await fetchProductsByIds(options.productIds)
    : await fetchAllProducts();

  const results: SyncResult[] = [];

  if (options.platforms.includes('gmc')) {
    if (!config.gmcConnected) {
      throw new Error(
        'GMC not connected. Please connect your account first.',
      );
    }

    const accessToken = await getValidGmcAccessToken(instanceId);
    const tokens = await getGmcTokens(instanceId);

    // Map and validate all products
    const validProducts: GmcProduct[] = [];
    const validationFailures: SyncResult[] = [];

    for (const product of products) {
      const gmcProducts = mapToGmc(
        product,
        config.fieldMappings,
        config.fieldMappings['siteUrl']?.defaultValue ?? '',
      );

      for (const gmcProduct of gmcProducts) {
        const errors = validateGmc(gmcProduct, product.id);

        if (errors.length > 0) {
          validationFailures.push({
            productId: product.id,
            platform: 'gmc',
            success: false,
            errors,
          });
        } else {
          validProducts.push(gmcProduct);
        }
      }
    }

    results.push(...validationFailures);

    // Push valid products via custombatch
    if (validProducts.length > 0) {
      const batchResults = await batchInsertProducts(
        tokens.merchantId,
        validProducts,
        accessToken,
      );

      for (const entry of batchResults) {
        const gmcProduct = validProducts[entry.batchId];
        if (!gmcProduct) continue;

        if (entry.errors) {
          results.push({
            productId: gmcProduct.offerId,
            platform: 'gmc',
            success: false,
            errors: entry.errors.errors.map((e) => ({
              field: 'api',
              platform: 'gmc' as const,
              message: e.message,
              productId: gmcProduct.offerId,
            })),
          });
        } else {
          results.push({
            productId: gmcProduct.offerId,
            platform: 'gmc',
            success: true,
            externalId: entry.product?.id,
          });
        }
      }
    }
  }

  // Write SyncState records
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

export async function syncProduct(
  instanceId: string,
  productId: string,
  platforms: SyncOptions['platforms'],
): Promise<BatchSyncResult> {
  return runFullSync(instanceId, {
    platforms,
    productIds: [productId],
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/backend/syncService.ts
git commit -m "feat: implement full sync orchestrator with fetch, map, validate, push pipeline"
```

---

### Task 7: Implement Connect Dashboard Page

**Files:**
- Modify: `src/extensions/dashboard/pages/connect/connect.tsx`

**Rules:**
- Dashboard pages call backend functions only
- No direct Wix SDK calls from frontend
- UI uses `@wix/design-system` exclusively

- [ ] **Step 1: Implement the Connect page UI**

Replace `src/extensions/dashboard/pages/connect/connect.tsx` with:

```tsx
import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Page,
  Text,
  Loader,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';

// These will call backend functions via Wix's RPC mechanism.
// Exact import path depends on how Wix CLI exposes backend modules.
// Placeholder — will wire up when backend HTTP endpoints are created.
async function callInitiateGmcOAuth(): Promise<string> {
  // TODO: wire to backend oauthService.initiateGmcOAuth
  throw new Error('Not wired');
}

async function callGetAppConfig(): Promise<{
  gmcConnected: boolean;
  metaConnected: boolean;
} | null> {
  // TODO: wire to backend dataService.getAppConfig
  return null;
}

const ConnectPage: FC = () => {
  const [gmcConnected, setGmcConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callGetAppConfig()
      .then((config) => {
        if (config) {
          setGmcConnected(config.gmcConnected);
        }
      })
      .catch(() => {
        // Config doesn't exist yet — first time setup
      })
      .finally(() => setLoading(false));
  }, []);

  const handleConnectGmc = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const authUrl = await callInitiateGmcOAuth();
      window.location.href = authUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start OAuth flow',
      );
      setConnecting(false);
    }
  }, []);

  if (loading) {
    return (
      <WixDesignSystemProvider features={{ newColorsBranding: true }}>
        <Page>
          <Page.Content>
            <Box align="center" padding="60px">
              <Loader />
            </Box>
          </Page.Content>
        </Page>
      </WixDesignSystemProvider>
    );
  }

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Connect"
          subtitle="Connect your product feed destinations"
        />
        <Page.Content>
          <Box direction="vertical" gap="24px">
            {error && (
              <SectionHelper appearance="danger">
                {error}
              </SectionHelper>
            )}

            <Card>
              <Card.Header
                title="Google Merchant Center"
                subtitle={
                  gmcConnected
                    ? 'Connected'
                    : 'Connect to sync products to Google Shopping'
                }
                suffix={
                  gmcConnected ? (
                    <Text size="small" skin="success" weight="bold">
                      Connected
                    </Text>
                  ) : (
                    <Button
                      size="small"
                      onClick={handleConnectGmc}
                      disabled={connecting}
                    >
                      {connecting ? 'Connecting...' : 'Connect'}
                    </Button>
                  )
                }
              />
            </Card>

            <Card>
              <Card.Header
                title="Meta Product Catalog"
                subtitle="Coming soon — Phase 4"
                suffix={
                  <Button size="small" disabled>
                    Connect
                  </Button>
                }
              />
            </Card>
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default ConnectPage;
```

- [ ] **Step 2: Commit**

```bash
git add src/extensions/dashboard/pages/connect/connect.tsx
git commit -m "feat: implement Connect page with GMC OAuth trigger and status display"
```

---

### Task 8: Wire Backend HTTP Endpoints for Dashboard

**Files:**
- Create: `src/backend/api/gmc-oauth-init.ts`
- Create: `src/backend/api/gmc-oauth-callback.ts`
- Create: `src/backend/api/sync-trigger.ts`
- Create: `src/backend/api/app-config.ts`

**Note:** Wix CLI backend HTTP endpoints follow Astro's file-based routing convention. Each file in `src/backend/api/` exports handler functions for HTTP methods.

- [ ] **Step 1: Create GMC OAuth init endpoint**

Create `src/backend/api/gmc-oauth-init.ts`:

```typescript
/**
 * GET /api/gmc-oauth-init
 * Returns the GMC OAuth authorization URL.
 */
import type { APIContext } from 'astro';
import { initiateGmcOAuth } from '../oauthService';

export async function GET(context: APIContext) {
  try {
    // TODO: extract instanceId from Wix app context
    const instanceId = context.url.searchParams.get('instanceId') ?? '';
    const authUrl = await initiateGmcOAuth(instanceId);
    return new Response(JSON.stringify({ authUrl }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 2: Create GMC OAuth callback endpoint**

Create `src/backend/api/gmc-oauth-callback.ts`:

```typescript
/**
 * GET /api/gmc-oauth-callback
 * Google redirects here after OAuth consent.
 * Exchanges code for tokens and stores them.
 */
import type { APIContext } from 'astro';
import { handleGmcCallback } from '../oauthService';
import { getAppConfig, saveAppConfig } from '../dataService';

export async function GET(context: APIContext) {
  const code = context.url.searchParams.get('code');
  const instanceId = context.url.searchParams.get('state') ?? '';

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
    await handleGmcCallback(instanceId, code);

    // Mark GMC as connected in AppConfig
    let config = await getAppConfig(instanceId);
    if (!config) {
      config = {
        instanceId,
        gmcConnected: true,
        metaConnected: false,
        fieldMappings: {},
        syncEnabled: false,
        lastFullSync: null,
      };
    } else {
      config.gmcConnected = true;
    }
    await saveAppConfig(config);

    // Redirect back to connect page with success
    return context.redirect('/dashboard/connect?gmc=connected');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(`OAuth failed: ${message}`, { status: 500 });
  }
}
```

- [ ] **Step 3: Create sync trigger endpoint**

Create `src/backend/api/sync-trigger.ts`:

```typescript
/**
 * POST /api/sync-trigger
 * Triggers a full sync for the given instance.
 */
import type { APIContext } from 'astro';
import { runFullSync } from '../syncService';
import type { Platform } from '../../types/sync.types';

export async function POST(context: APIContext) {
  try {
    const body = (await context.request.json()) as {
      instanceId: string;
      platforms?: Platform[];
    };

    const result = await runFullSync(body.instanceId, {
      platforms: body.platforms ?? ['gmc'],
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 4: Create app config endpoint**

Create `src/backend/api/app-config.ts`:

```typescript
/**
 * GET /api/app-config
 * Returns the current AppConfig for the instance.
 */
import type { APIContext } from 'astro';
import { getAppConfig } from '../dataService';

export async function GET(context: APIContext) {
  try {
    const instanceId =
      context.url.searchParams.get('instanceId') ?? '';
    const config = await getAppConfig(instanceId);

    return new Response(JSON.stringify(config), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/backend/api/
git commit -m "feat: add HTTP endpoints for OAuth, sync trigger, and app config"
```

---

### Task 9: Implement dataService.ts with Wix Data SDK

**Files:**
- Modify: `src/backend/dataService.ts`

**Note:** The Wix Data SDK in the CLI context uses `@wix/essentials` or `@wix/data`. The exact API depends on the Wix CLI version. This task fills in the TODO stubs from Task 1.

- [ ] **Step 1: Implement dataService with Wix Data**

Replace `src/backend/dataService.ts` with:

```typescript
/**
 * dataService.ts
 *
 * CRUD helpers for AppConfig and SyncState Wix Data collections.
 * All Wix Data access is centralized here.
 */

import { items } from '@wix/data';
import type { AppConfig, SyncState } from '../types/wix.types';

const COLLECTION_APP_CONFIG = 'AppConfig';
const COLLECTION_SYNC_STATE = 'SyncState';

export async function getAppConfig(
  instanceId: string,
): Promise<AppConfig | null> {
  const result = await items
    .queryDataItems({ dataCollectionId: COLLECTION_APP_CONFIG })
    .eq('instanceId', instanceId)
    .limit(1)
    .find();

  const item = result.items?.[0]?.data;
  if (!item) return null;

  return {
    instanceId: item.instanceId,
    gmcConnected: item.gmcConnected ?? false,
    metaConnected: item.metaConnected ?? false,
    fieldMappings: item.fieldMappings
      ? JSON.parse(item.fieldMappings)
      : {},
    syncEnabled: item.syncEnabled ?? false,
    lastFullSync: item.lastFullSync
      ? new Date(item.lastFullSync)
      : null,
  } as AppConfig;
}

export async function saveAppConfig(
  config: AppConfig,
): Promise<void> {
  const existing = await items
    .queryDataItems({ dataCollectionId: COLLECTION_APP_CONFIG })
    .eq('instanceId', config.instanceId)
    .limit(1)
    .find();

  const data = {
    instanceId: config.instanceId,
    gmcConnected: config.gmcConnected,
    metaConnected: config.metaConnected,
    fieldMappings: JSON.stringify(config.fieldMappings),
    syncEnabled: config.syncEnabled,
    lastFullSync: config.lastFullSync?.toISOString() ?? null,
  };

  if (existing.items?.[0]) {
    await items.updateDataItem({
      dataCollectionId: COLLECTION_APP_CONFIG,
      dataItem: {
        _id: existing.items[0]._id,
        data,
      },
    });
  } else {
    await items.insertDataItem({
      dataCollectionId: COLLECTION_APP_CONFIG,
      dataItem: { data },
    });
  }
}

export async function getSyncState(
  productId: string,
  platform: 'gmc' | 'meta',
): Promise<SyncState | null> {
  const result = await items
    .queryDataItems({ dataCollectionId: COLLECTION_SYNC_STATE })
    .eq('productId', productId)
    .eq('platform', platform)
    .limit(1)
    .find();

  const item = result.items?.[0]?.data;
  if (!item) return null;

  return {
    productId: item.productId,
    platform: item.platform,
    status: item.status,
    lastSynced: new Date(item.lastSynced),
    errorLog: item.errorLog ? JSON.parse(item.errorLog) : null,
    externalId: item.externalId ?? '',
  } as SyncState;
}

export async function upsertSyncState(
  state: SyncState,
): Promise<void> {
  const existing = await items
    .queryDataItems({ dataCollectionId: COLLECTION_SYNC_STATE })
    .eq('productId', state.productId)
    .eq('platform', state.platform)
    .limit(1)
    .find();

  const data = {
    productId: state.productId,
    platform: state.platform,
    status: state.status,
    lastSynced: state.lastSynced.toISOString(),
    errorLog: state.errorLog ? JSON.stringify(state.errorLog) : null,
    externalId: state.externalId,
  };

  if (existing.items?.[0]) {
    await items.updateDataItem({
      dataCollectionId: COLLECTION_SYNC_STATE,
      dataItem: {
        _id: existing.items[0]._id,
        data,
      },
    });
  } else {
    await items.insertDataItem({
      dataCollectionId: COLLECTION_SYNC_STATE,
      dataItem: { data },
    });
  }
}

export async function bulkUpsertSyncStates(
  states: SyncState[],
): Promise<void> {
  // Wix Data doesn't have a native bulk upsert, so we iterate.
  // For large catalogs, consider batching with Promise.all in chunks.
  const CHUNK_SIZE = 50;
  for (let i = 0; i < states.length; i += CHUNK_SIZE) {
    const chunk = states.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map((s) => upsertSyncState(s)));
  }
}
```

- [ ] **Step 2: Add `@wix/data` to package.json if not present**

```bash
cd /Users/curtismcewen/Documents/Git/SyncStream/sync-stream && npm ls @wix/data 2>&1 || npm install @wix/data
```

- [ ] **Step 3: Commit**

```bash
git add src/backend/dataService.ts package.json package-lock.json
git commit -m "feat: implement Wix Data service for AppConfig and SyncState collections"
```

---

### Task 10: Integration Smoke Test and Final Wiring

**Files:**
- Modify: `src/extensions/dashboard/pages/connect/connect.tsx` (wire API calls)

- [ ] **Step 1: Wire the Connect page to backend API endpoints**

Update the placeholder functions at the top of `connect.tsx`:

```typescript
async function callInitiateGmcOAuth(): Promise<string> {
  const response = await fetch('/api/gmc-oauth-init?instanceId=default');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.authUrl;
}

async function callGetAppConfig(): Promise<{
  gmcConnected: boolean;
  metaConnected: boolean;
} | null> {
  const response = await fetch('/api/app-config?instanceId=default');
  if (!response.ok) return null;
  return response.json();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/curtismcewen/Documents/Git/SyncStream/sync-stream && npx tsc --noEmit
```

Fix any type errors that surface. Common issues:
- `@wix/stores` types may not match our `WixProduct` interface exactly — cast with `as unknown as WixProduct`
- `@wix/data` import path may need adjustment based on installed version

- [ ] **Step 3: Commit**

```bash
git add src/extensions/dashboard/pages/connect/connect.tsx
git commit -m "feat: wire Connect page to backend API endpoints"
```

- [ ] **Step 4: Push all Phase 2 work**

```bash
git push origin main
```

---

## Post-Implementation Notes

**What's NOT in this plan (deferred to later phases):**
- Phase 3: Webhook handler, incremental sync, Status dashboard
- Phase 4: Meta OAuth, Meta mapper, Meta client
- Phase 5: Mapping UI, category mapping (port category_map.json)
- Phase 6: Error UX, manual sync trigger, billing

**Known limitations of this MVP:**
- `dataService.ts` uses sequential upserts — fine for small catalogs, needs optimization for 10K+ products
- N+1 product fetch (query then getProduct per product) — the Wix SDK doesn't return variant data in bulk queries
- `contentLanguage`/`targetCountry` hardcoded to `en`/`US` — needs merchant configuration later
- `instanceId` handling is placeholder ("default") — needs proper Wix app context extraction
- Backend API endpoints need authentication/authorization middleware

**Testing strategy:**
- Run `wix dev` against a development site with Wix Stores installed
- Set up GMC OAuth credentials in Google Cloud Console
- Store `gmc_client_id`, `gmc_client_secret`, `gmc_redirect_uri` in Wix Secrets Manager
- Store `gmc_merchant_id_{instanceId}` after OAuth
- Trigger a full sync and verify products appear in GMC
