/** Wix product as returned by the Stores Products API. */
export interface WixProduct {
  _id: string;
  name: string;
  description: string;
  slug: string;
  sku: string;
  price: {
    amount: string;
    currency: string;
  };
  media: {
    mainMedia?: {
      image?: { url: string };
    };
  };
  stock: {
    inStock: boolean;
  };
  customFields?: Record<string, string>;
  productPageUrl?: { path: string };
}

/** Shape stored in the AppConfig Wix Data collection. */
export interface AppConfig {
  instanceId: string;
  gmcConnected: boolean;
  metaConnected: boolean;
  fieldMappings: FieldMappings;
  syncEnabled: boolean;
  lastFullSync: Date | null;
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
}
