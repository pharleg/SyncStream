/**
 * validator.ts
 *
 * Validates products against GMC / Meta required-field rules
 * before any push. Returns structured errors per product.
 * A batch does NOT abort for one bad product.
 */

import type { ValidationError, FieldMappings } from '../types/wix.types';
import type { GmcProductInput } from '../types/gmc.types';
import type { MetaProduct } from '../types/meta.types';
import type { ProductComplianceResult, ComplianceSummary } from '../types/sync.types';
import { flattenVariants, mapFlattenedToGmc } from './productMapper';
import { applyRules } from './rulesEngine';
import { getRules, getFilters, getAppConfig } from './dataService';
import { applyFilters } from './filterEngine';

function requiredString(
  value: string | undefined,
  field: string,
  productId: string,
  severity: 'error' | 'warning' = 'error',
): ValidationError | null {
  if (!value || value.trim().length === 0) {
    return {
      field,
      platform: 'gmc',
      message: `${field} is required and must not be empty`,
      productId,
      severity,
    };
  }
  return null;
}

export function validateGmc(
  product: GmcProductInput,
  productId: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const attrs = product.productAttributes;

  // Required string fields on productAttributes
  const requiredAttrFields: (keyof typeof attrs)[] = [
    'title',
    'description',
    'link',
    'imageLink',
  ];

  for (const field of requiredAttrFields) {
    const err = requiredString(
      attrs[field] as string | undefined,
      field,
      productId,
    );
    if (err) errors.push(err);
  }

  // Brand: warning-level — MPN is auto-generated so GMC won't disapprove, but
  // adding a real brand improves catalog matching and Shopping ad performance.
  if (!attrs.brand || attrs.brand.trim().length === 0) {
    errors.push({
      field: 'brand',
      platform: 'gmc',
      message: 'No brand name set — add your store or brand name in Field Mapping to improve how this product appears in Google.',
      productId,
      severity: 'warning',
    });
  }

  // offerId is on the root product, not productAttributes
  const offerErr = requiredString(product.offerId, 'offerId', productId);
  if (offerErr) errors.push(offerErr);

  if (product.offerId && product.offerId.length > 40) {
    errors.push({
      field: 'offerId',
      platform: 'gmc',
      message: `Product code (SKU) is too long (${product.offerId.length} characters, max 40). Shorten the SKU on this product in Wix.`,
      productId,
      severity: 'error',
    });
  }

  // SKU warning: hex-only fallback IDs suggest no merchant SKU was set.
  // Fallback format: 32 hex chars (single) or 19hex_19hex (multi-variant).
  if (product.offerId) {
    const looksLikeFallback = /^[0-9a-f]{19,32}(_[0-9a-f]{19,32})?$/i.test(product.offerId);
    if (looksLikeFallback) {
      errors.push({
        field: 'offerId',
        platform: 'gmc',
        message: 'No product code (SKU) — we assigned one automatically. Tip: adding an SKU in Wix helps you track this product more easily.',
        productId,
        severity: 'warning',
      });
    }
  }

  // Availability must be uppercase enum
  if (!['IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'BACKORDER'].includes(attrs.availability)) {
    errors.push({
      field: 'availability',
      platform: 'gmc',
      message: `availability must be "IN_STOCK", "OUT_OF_STOCK", "PREORDER", or "BACKORDER", got "${attrs.availability}"`,
      productId,
      severity: 'error',
    });
  }

  // Condition must be uppercase enum
  if (!['NEW', 'USED', 'REFURBISHED'].includes(attrs.condition)) {
    errors.push({
      field: 'condition',
      platform: 'gmc',
      message: `condition must be "NEW", "USED", or "REFURBISHED", got "${attrs.condition}"`,
      productId,
      severity: 'error',
    });
  }

  // Price amountMicros must be a positive integer string
  const micros = attrs.price?.amountMicros;
  const microsVal = micros !== undefined ? parseInt(micros, 10) : NaN;
  if (!micros || isNaN(microsVal) || microsVal <= 0 || String(microsVal) !== micros) {
    errors.push({
      field: 'price.amountMicros',
      platform: 'gmc',
      message: `price.amountMicros must be a positive integer string, got "${micros}"`,
      productId,
      severity: 'error',
    });
  }

  // Price currencyCode required
  if (!attrs.price?.currencyCode) {
    errors.push({
      field: 'price.currencyCode',
      platform: 'gmc',
      message: 'price.currencyCode is required',
      productId,
      severity: 'error',
    });
  }

  // Description quality warnings
  if (attrs.description && attrs.description === attrs.title) {
    errors.push({
      field: 'description',
      platform: 'gmc',
      message: 'Product description is the same as the title. Add a real description to improve how this product shows up in Google Shopping.',
      productId,
      severity: 'warning',
    });
  } else if (attrs.description && attrs.description.length < 50 && attrs.description !== attrs.title) {
    errors.push({
      field: 'description',
      platform: 'gmc',
      message: `Description is very short (${attrs.description.length} characters). Add more detail — Google recommends at least 150 characters for better visibility.`,
      productId,
      severity: 'warning',
    });
  }

  // Description max 5000 chars
  if (attrs.description && attrs.description.length > 5000) {
    errors.push({
      field: 'description',
      platform: 'gmc',
      message: `description exceeds 5000 character limit (${attrs.description.length} chars)`,
      productId,
      severity: 'error',
    });
  }

  // Link must be a valid URL
  if (attrs.link && !attrs.link.startsWith('http')) {
    errors.push({
      field: 'link',
      platform: 'gmc',
      message: 'link must be a valid URL starting with http',
      productId,
      severity: 'error',
    });
  }

  // Image link must be a valid URL
  if (attrs.imageLink && !attrs.imageLink.startsWith('http')) {
    errors.push({
      field: 'imageLink',
      platform: 'gmc',
      message: 'imageLink must be a valid URL starting with http',
      productId,
      severity: 'error',
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

/**
 * Run compliance validation on products without triggering a sync.
 * Returns per-product results and an overall health score.
 */
export async function runComplianceCheck(
  instanceId: string,
  products: import('../types/wix.types').WixProduct[],
  platform: 'gmc' | 'meta' = 'gmc',
): Promise<ComplianceSummary> {
  const config = await getAppConfig(instanceId);
  const mappings = config?.fieldMappings ?? {};
  const siteUrl = mappings['siteUrl']?.defaultValue ?? '';
  const filters = await getFilters(instanceId, platform);
  const filtered = applyFilters(products, filters, platform);
  const flattened = filtered.flatMap((p) => flattenVariants(p));
  const rules = await getRules(instanceId, platform);

  const results: ProductComplianceResult[] = [];

  for (const item of flattened) {
    if (platform === 'gmc') {
      const gmcProduct = mapFlattenedToGmc(item, mappings, siteUrl);
      const transformed = applyRules([gmcProduct], rules, platform);
      const allIssues = validateGmc(transformed[0], transformed[0].offerId);
      const errors = allIssues.filter((e) => e.severity === 'error');
      const warnings = allIssues.filter((e) => e.severity === 'warning');
      results.push({
        productId: item.product._id ?? item.product.id,
        offerId: transformed[0].offerId,
        errors,
        warnings,
        compliant: errors.length === 0,
      });
    }
  }

  const compliantCount = results.filter((r) => r.compliant).length;
  const warningCount = results.filter((r) => r.warnings.length > 0).length;
  const errorCount = results.filter((r) => !r.compliant).length;
  const healthScore = results.length > 0
    ? Math.round((compliantCount / results.length) * 100)
    : 100;

  return {
    totalProducts: results.length,
    compliantCount,
    warningCount,
    errorCount,
    healthScore,
    results,
  };
}
