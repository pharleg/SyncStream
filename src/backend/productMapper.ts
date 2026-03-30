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
