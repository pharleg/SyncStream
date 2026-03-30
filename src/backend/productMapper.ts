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
 * Map a Wix product to one or more GMC ProductInput objects (Merchant API v1).
 * Multi-variant products expand to one row per variant.
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
        offerId: variant?.id ?? product.id,
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
      itemGroupId: product.id,
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
      offerId: variant.id,
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
