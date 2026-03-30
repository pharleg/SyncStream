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
