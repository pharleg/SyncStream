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

  if (isMultiVariant && variant) {
    productAttributes.itemGroupId = item.parentId;
    const { color, size, material, pattern } = extractChoiceValues(variant);
    if (color) productAttributes.color = color;
    if (size) productAttributes.size = size;
    // material and pattern are extracted but GMC doesn't have dedicated fields for them
    // They can be added via custom attributes in a future update
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

    if (gtin) productAttributes.gtins = [gtin];
    if (mpn) productAttributes.mpn = mpn;
    if (!gtin && !mpn) productAttributes.identifierExists = false;
    if (googleProductCategory)
      productAttributes.googleProductCategory = googleProductCategory;
    if (additionalImageLinks.length > 0)
      productAttributes.additionalImageLinks = additionalImageLinks;

    return [
      {
        offerId: variant?._id ?? variant?.id ?? product._id ?? product.id,
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
    if (gtin) productAttributes.gtins = [gtin];
    if (mpn) productAttributes.mpn = mpn;
    if (!gtin && !mpn) productAttributes.identifierExists = false;
    if (googleProductCategory)
      productAttributes.googleProductCategory = googleProductCategory;
    if (additionalImageLinks.length > 0)
      productAttributes.additionalImageLinks = additionalImageLinks;

    return {
      offerId: variant._id ?? variant.id,
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
