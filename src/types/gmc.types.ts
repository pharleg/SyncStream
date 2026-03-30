/** Product entry for the Google Content API for Shopping v2.1. */
export interface GmcProduct {
  offerId: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  availability: 'in_stock' | 'out_of_stock';
  price: { value: string; currency: string };
  brand: string;
  gtin?: string;
  mpn?: string;
  condition: 'new' | 'refurbished' | 'used';
  contentLanguage: string;
  targetCountry: string;
  channel: string;
  itemGroupId?: string;
  additionalImageLinks?: string[];
  color?: string;
  sizes?: string[];
  ageGroup?: string;
  gender?: string;
  googleProductCategory?: string;
  salePrice?: { value: string; currency: string };
  identifierExists?: boolean;
}

/** Response from a GMC products.insert / products.custombatch call. */
export interface GmcInsertResponse {
  id: string;
  offerId: string;
  errors?: GmcError[];
}

export interface GmcError {
  domain: string;
  reason: string;
  message: string;
}

/** OAuth token pair stored in Wix Secrets Manager. */
export interface GmcTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  merchantId: string;
}

/** Configuration for GMC OAuth (loaded from environment/secrets). */
export interface GmcOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

/** A single entry in a custombatch request. */
export interface GmcBatchEntry {
  batchId: number;
  merchantId: string;
  method: 'insert' | 'get' | 'delete';
  product?: GmcProduct;
  productId?: string; // REST ID for get/delete: "online:en:US:{offerId}"
}

/** Response from custombatch. */
export interface GmcBatchResponse {
  entries: GmcBatchResponseEntry[];
}

export interface GmcBatchResponseEntry {
  batchId: number;
  product?: { id: string; offerId: string };
  errors?: {
    errors: GmcError[];
    code: number;
    message: string;
  };
}
