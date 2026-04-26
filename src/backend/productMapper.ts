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
  FlattenedProduct,
} from '../types/wix.types';
import type {
  GmcProductInput,
  GmcProductAttributes,
} from '../types/gmc.types';
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
 * Strip hyphens from a UUID and return at most `maxLen` chars.
 */
function shortId(id: string, maxLen = 32): string {
  return id.replace(/-/g, '').slice(0, maxLen);
}

// GMC Merchant API v1 validates the composite resource ID as
// `{contentLanguage}~{feedLabel}~{offerId}` = "en~US~" (6 chars) + offerId.
// Effective offerId limit = 50 - 6 = 44. Use 40 for safety margin.
const OFFER_ID_MAX = 40;

/**
 * Build a GMC-safe offerId (max 40 chars after accounting for the en~US~ prefix).
 * - SKU: truncated to 40 chars.
 * - Multi-variant fallback: 19hex + '_' + 19hex = 39 chars.
 * - Single-variant fallback: 32 hex chars (UUID without hyphens).
 */
function buildOfferId(sku: string | undefined, parentId: string, variantId: string, isMultiVariant: boolean): string {
  if (sku) return truncate(sku, OFFER_ID_MAX);
  if (isMultiVariant) return `${shortId(parentId, 19)}_${shortId(variantId, 19)}`;
  return shortId(parentId);
}

/**
 * Build a GMC-safe MPN (max 70 chars) from Wix product/variant IDs.
 * Same format as buildOfferId but with the full 32-char hex IDs where possible.
 */
function buildAutoMpn(parentId: string, variantId: string, isMultiVariant: boolean): string {
  if (isMultiVariant) return `${shortId(parentId, 32)}_${shortId(variantId, 32)}`;
  return shortId(parentId);
}

/** Convert a decimal price string or number to amountMicros string. */
function toAmountMicros(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0';
  return String(Math.round(num * 1_000_000));
}

/**
 * Extract price from a Wix product using the fallback chain.
 * Returns { amountMicros: "14990000", currencyCode: "USD" }.
 */
function extractPrice(
  product: WixProduct,
  variant?: WixVariant,
): { amountMicros: string; currencyCode: string } {
  const currencyCode = product.currency ?? 'USD';

  // Variant-level price override
  if (variant?.price?.actualPrice?.amount) {
    return {
      amountMicros: toAmountMicros(variant.price.actualPrice.amount),
      currencyCode,
    };
  }

  // Fallback 1: actualPriceRange.minValue.amount
  if (product.actualPriceRange?.minValue?.amount) {
    return {
      amountMicros: toAmountMicros(product.actualPriceRange.minValue.amount),
      currencyCode,
    };
  }

  // Fallback 2: priceData.price
  if (product.priceData?.price != null) {
    return {
      amountMicros: toAmountMicros(product.priceData.price),
      currencyCode,
    };
  }

  // Fallback 3: price.price
  if (product.price?.price != null) {
    return {
      amountMicros: toAmountMicros(product.price.price),
      currencyCode,
    };
  }

  return { amountMicros: '0', currencyCode };
}

/** Resolve a mapped field value from product data. */
function resolveMappedField(
  product: WixProduct,
  fieldName: string,
  mappings: FieldMappings,
): string | undefined {
  const mapping = mappings[fieldName];
  if (!mapping) return undefined;

  if (mapping.type === 'customField' && mapping.wixField) {
    // Try extendedFields first, then legacy customFields
    const extVal =
      product.extendedFields?.namespaces?.['@wix/stores']?.[
        mapping.wixField
      ];
    if (typeof extVal === 'string') return extVal;
    return product.customFields?.[mapping.wixField];
  }

  // Default: return defaultValue (handles both type === 'default' and missing type)
  if (mapping.defaultValue) {
    return mapping.defaultValue;
  }

  return undefined;
}

/**
 * Convert a Wix media URL to an HTTPS URL.
 * Wix format: "wix:image://v1/{filename}/{displayName}#originWidth=...&originHeight=..."
 * Output: "https://static.wixstatic.com/media/{filename}"
 */
function wixImageToUrl(wixImage: string | undefined): string {
  if (!wixImage) return '';
  if (wixImage.startsWith('http')) return wixImage;
  // Extract filename from wix:image://v1/{filename}/...
  const match = wixImage.match(/wix:image:\/\/v1\/([^/]+)/);
  if (match) {
    return `https://static.wixstatic.com/media/${match[1]}`;
  }
  return '';
}

/** Get the main image URL from a product or variant. */
function getImageLink(
  product: WixProduct,
  variant?: WixVariant,
): string {
  // V3 SDK: media.main.image is a wix:image:// string, not an object
  const variantImage = (variant?.media as any)?.image ?? variant?.media?.mainMedia?.image?.url;
  const mainImage = (product.media?.main as any)?.image ?? product.media?.main?.image?.url;
  const firstGalleryImage = (product.media?.itemsInfo?.items?.[0] as any)?.image;

  return wixImageToUrl(variantImage) || wixImageToUrl(mainImage) || wixImageToUrl(firstGalleryImage) || '';
}

/** Get additional image URLs (up to 10, excluding main). */
function getAdditionalImageLinks(product: WixProduct): string[] {
  const mainImage = (product.media?.main as any)?.image;
  const items = product.media?.itemsInfo?.items ?? [];
  return items
    .map((item) => wixImageToUrl((item as any)?.image ?? item.image?.url))
    .filter((url) => url && url !== wixImageToUrl(mainImage))
    .slice(0, 10);
}

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

/** Build the product page URL. */
function buildProductLink(product: WixProduct, siteUrl: string): string {
  // V3 SDK: url can be a string or { relativePath, url }
  const urlVal = product.url as unknown;
  if (typeof urlVal === 'string' && urlVal.startsWith('http')) return urlVal;
  if (typeof urlVal === 'object' && urlVal !== null) {
    const obj = urlVal as { url?: string; relativePath?: string };
    if (obj.url) return obj.url;
    if (obj.relativePath) return `${siteUrl}${obj.relativePath}`;
  }
  return `${siteUrl}/product-page/${product.slug}`;
}

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
      sku: variants[0]?.sku || undefined,
      isMultiVariant: false,
    }];
  }

  return variants.map((variant) => ({
    product,
    variant,
    parentId,
    itemId: variant._id ?? variant.id,
    sku: variant.sku || undefined,
    isMultiVariant: true,
  }));
}

/**
 * Map a FlattenedProduct to a GmcProductInput.
 * New pipeline entry point — works on pre-flattened items.
 * Enhanced title/description can override the product's originals.
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
  const storeName = resolveMappedField(product, 'storeName', mappings);
  const brand =
    product.brand?.name ??
    resolveMappedField(product, 'brand', mappings) ??
    storeName ??
    '';
  const condition = (
    resolveMappedField(product, 'condition', mappings)?.toUpperCase() as
      | GmcProductAttributes['condition']
      | undefined
  ) ?? 'NEW';
  const gtin = resolveMappedField(product, 'gtin', mappings);
  const mpnMapped = resolveMappedField(product, 'mpn', mappings);
  const mpn = mpnMapped ?? buildAutoMpn(item.parentId, item.itemId, item.isMultiVariant);
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

  if (isMultiVariant && variant) {
    productAttributes.itemGroupId = item.parentId;
    const { color, size, material, pattern } = extractChoiceValues(variant);
    if (color) productAttributes.color = color;
    if (size) productAttributes.size = size;
    // material and pattern are extracted but GMC doesn't have dedicated fields for them
    // They can be added via custom attributes in a future update
  }

  if (gtin) {
    productAttributes.gtins = [gtin];
  } else {
    // Always set MPN — either merchant-mapped or auto-generated from Wix product IDs.
    // brand + mpn satisfies GMC identifier requirement without a GTIN.
    productAttributes.mpn = mpn;
    // Only declare identifierExists: false when brand is also absent — no brand means
    // GMC can't match the product even with an MPN.
    if (!brand) productAttributes.identifierExists = false;
  }
  if (googleProductCategory) productAttributes.googleProductCategory = googleProductCategory;
  if (additionalImageLinks.length > 0) productAttributes.additionalImageLinks = additionalImageLinks;

  // GMC offerId: SKU if set, else compact hex IDs (max 50 chars)
  const offerId = buildOfferId(item.sku, item.parentId, item.itemId, item.isMultiVariant);

  return {
    offerId,
    contentLanguage: 'en',
    feedLabel: 'US',
    productAttributes,
  };
}

/**
 * Map a Wix product to one or more GMC ProductInput objects (Merchant API v1).
 * Multi-variant products expand to one row per variant.
 * @deprecated Use flattenVariants + mapFlattenedToGmc for the new pipeline.
 */
export function mapToGmc(
  product: WixProduct,
  mappings: FieldMappings,
  siteUrl: string,
): GmcProductInput[] {
  const rawDesc = product.plainDescription ?? product.description ?? '';
  const description = truncate(stripHtml(rawDesc), 5000) || product.name;
  const storeName = resolveMappedField(product, 'storeName', mappings);
  const brand =
    product.brand?.name ??
    resolveMappedField(product, 'brand', mappings) ??
    storeName ??
    '';
  const condition = (
    resolveMappedField(product, 'condition', mappings)?.toUpperCase() as
      | GmcProductAttributes['condition']
      | undefined
  ) ?? 'NEW';
  const gtin = resolveMappedField(product, 'gtin', mappings);
  const mpn = resolveMappedField(product, 'mpn', mappings);
  const googleProductCategory = resolveMappedField(
    product,
    'googleProductCategory',
    mappings,
  );
  const additionalImageLinks = getAdditionalImageLinks(product);

  const variants = product.variantsInfo?.variants ?? [];

  // Single product (no variants or single variant)
  if (variants.length <= 1) {
    const variant = variants[0];
    const price = extractPrice(product, variant);
    const availability: GmcProductAttributes['availability'] =
      product.inventory?.availabilityStatus === 'OUT_OF_STOCK'
        ? 'OUT_OF_STOCK'
        : 'IN_STOCK';

    const productAttributes: GmcProductAttributes = {
      title: product.name,
      description,
      link: buildProductLink(product, siteUrl),
      imageLink: getImageLink(product, variant),
      availability,
      price,
      brand,
      condition,
    };

    const productId = product._id ?? product.id;
    const variantId = variant?._id ?? variant?.id ?? productId;
    const isMultiV = false;
    if (gtin) {
      productAttributes.gtins = [gtin];
    } else {
      productAttributes.mpn = mpn ?? buildAutoMpn(productId, variantId, isMultiV);
      if (!brand) productAttributes.identifierExists = false;
    }
    if (googleProductCategory)
      productAttributes.googleProductCategory = googleProductCategory;
    if (additionalImageLinks.length > 0)
      productAttributes.additionalImageLinks = additionalImageLinks;

    return [
      {
        offerId: buildOfferId(undefined, productId, variantId, isMultiV),
        contentLanguage: 'en',
        feedLabel: 'US',
        productAttributes,
      },
    ];
  }

  // Multi-variant: one GMC ProductInput per variant
  return variants.map((variant) => {
    const price = extractPrice(product, variant);
    const { color, size } = extractChoiceValues(variant);
    const inStock = variant.inventoryStatus?.inStock !== false;

    const productAttributes: GmcProductAttributes = {
      title: product.name,
      description,
      link: buildProductLink(product, siteUrl),
      imageLink: getImageLink(product, variant),
      availability: inStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
      price,
      brand,
      condition,
      itemGroupId: product._id ?? product.id,
    };

    if (color) productAttributes.color = color;
    if (size) productAttributes.size = size;
    const parentId = product._id ?? product.id;
    const vId = variant._id ?? variant.id;
    if (gtin) {
      productAttributes.gtins = [gtin];
    } else {
      productAttributes.mpn = mpn ?? buildAutoMpn(parentId, vId, true);
      if (!brand) productAttributes.identifierExists = false;
    }
    if (googleProductCategory)
      productAttributes.googleProductCategory = googleProductCategory;
    if (additionalImageLinks.length > 0)
      productAttributes.additionalImageLinks = additionalImageLinks;

    return {
      offerId: buildOfferId(undefined, parentId, vId, true),
      contentLanguage: 'en',
      feedLabel: 'US',
      productAttributes,
    };
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
