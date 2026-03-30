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

export function validateGmc(
  _product: GmcProduct,
  _productId: string,
): ValidationError[] {
  // TODO Phase 2: implement GMC validation
  return [];
}

export function validateMeta(
  _product: MetaProduct,
  _productId: string,
): ValidationError[] {
  // TODO Phase 4: implement Meta validation
  return [];
}
