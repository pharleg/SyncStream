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
  _id?: string;
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
  _id?: string;
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

/** Shape stored in the AppConfig Wix Data collection. */
export interface AppConfig {
  instanceId: string;
  gmcConnected: boolean;
  metaConnected: boolean;
  fieldMappings: FieldMappings;
  syncEnabled: boolean;
  lastFullSync: Date | null;
  /** Merchant API data source ID for product uploads. */
  gmcDataSourceId?: string;
  /** Whether AI description enhancement is enabled. */
  aiEnhancementEnabled?: boolean;
  /** Optional style/tone instructions for AI enhancement. */
  aiEnhancementStyle?: string;
}

/** Flexible field-mapping model.
 *  Each key is the target platform field name (e.g. "brand").
 *  Value is either a Wix custom-field key or a static default. */
export interface FieldMapping {
  type: 'customField' | 'default';
  /** Wix custom-field key when type === 'customField'. */
  wixField?: string;
  /** Static value when type === 'default'. */
  defaultValue?: string;
}

export type FieldMappings = Record<string, FieldMapping>;

/** Shape stored in the SyncState Wix Data collection. */
export interface SyncState {
  productId: string;
  platform: 'gmc' | 'meta';
  status: 'synced' | 'error' | 'pending';
  lastSynced: Date;
  errorLog: ValidationError[] | null;
  externalId: string;
}

export interface ValidationError {
  field: string;
  platform: 'gmc' | 'meta';
  message: string;
  productId: string;
  severity: 'error' | 'warning';
}

/** A product flattened to a single variant for pipeline processing. */
export interface FlattenedProduct {
  product: WixProduct;
  variant?: WixVariant;
  parentId: string;
  itemId: string;
  sku?: string;
  isMultiVariant: boolean;
}
