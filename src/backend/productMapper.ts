/**
 * productMapper.ts
 *
 * Transforms Wix products into GMC and Meta product formats
 * using the merchant's field mappings from AppConfig.
 */

import type { WixProduct, FieldMappings } from '../types/wix.types';
import type { GmcProduct } from '../types/gmc.types';
import type { MetaProduct } from '../types/meta.types';

export function mapToGmc(
  _product: WixProduct,
  _mappings: FieldMappings,
  _siteUrl: string,
): GmcProduct {
  // TODO Phase 2: implement GMC mapping
  throw new Error('Not implemented');
}

export function mapToMeta(
  _product: WixProduct,
  _mappings: FieldMappings,
  _siteUrl: string,
): MetaProduct {
  // TODO Phase 4: implement Meta mapping
  throw new Error('Not implemented');
}
