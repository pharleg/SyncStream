/**
 * validator.ts
 *
 * Validates products against GMC / Meta required-field rules
 * before any push. Returns structured errors per product.
 * A batch does NOT abort for one bad product.
 */

import type { ValidationError } from '../types/wix.types';
import type { GmcProductInput } from '../types/gmc.types';
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
    'brand',
  ];

  for (const field of requiredAttrFields) {
    const err = requiredString(
      attrs[field] as string | undefined,
      field,
      productId,
    );
    if (err) errors.push(err);
  }

  // offerId is on the root product, not productAttributes
  const offerErr = requiredString(product.offerId, 'offerId', productId);
  if (offerErr) errors.push(offerErr);

  // Availability must be uppercase enum
  if (!['IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'BACKORDER'].includes(attrs.availability)) {
    errors.push({
      field: 'availability',
      platform: 'gmc',
      message: `availability must be "IN_STOCK", "OUT_OF_STOCK", "PREORDER", or "BACKORDER", got "${attrs.availability}"`,
      productId,
    });
  }

  // Condition must be uppercase enum
  if (!['NEW', 'USED', 'REFURBISHED'].includes(attrs.condition)) {
    errors.push({
      field: 'condition',
      platform: 'gmc',
      message: `condition must be "NEW", "USED", or "REFURBISHED", got "${attrs.condition}"`,
      productId,
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
    });
  }

  // Price currencyCode required
  if (!attrs.price?.currencyCode) {
    errors.push({
      field: 'price.currencyCode',
      platform: 'gmc',
      message: 'price.currencyCode is required',
      productId,
    });
  }

  // Description max 5000 chars
  if (attrs.description && attrs.description.length > 5000) {
    errors.push({
      field: 'description',
      platform: 'gmc',
      message: `description exceeds 5000 character limit (${attrs.description.length} chars)`,
      productId,
    });
  }

  // Link must be a valid URL
  if (attrs.link && !attrs.link.startsWith('http')) {
    errors.push({
      field: 'link',
      platform: 'gmc',
      message: 'link must be a valid URL starting with http',
      productId,
    });
  }

  // Image link must be a valid URL
  if (attrs.imageLink && !attrs.imageLink.startsWith('http')) {
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
