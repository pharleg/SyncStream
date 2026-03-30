/**
 * Types for Google Merchant API v1.
 * Replaces Content API for Shopping v2.1 (sunsetting Aug 2026).
 * Docs: https://developers.google.com/merchant/api/reference/rest
 */

/** Price in micros format. 1,000,000 micros = 1 currency unit. */
export interface GmcPrice {
  amountMicros: string; // e.g. "14990000" for $14.99
  currencyCode: string; // e.g. "USD"
}

/** ProductInput attributes for Merchant API v1. */
export interface GmcProductAttributes {
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks?: string[];
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'PREORDER' | 'BACKORDER';
  price: GmcPrice;
  salePrice?: GmcPrice;
  condition: 'NEW' | 'USED' | 'REFURBISHED';
  brand: string;
  gtins?: string[];
  mpn?: string;
  identifierExists?: boolean;
  itemGroupId?: string;
  color?: string;
  size?: string;
  ageGroup?: string;
  gender?: string;
  googleProductCategory?: string;
}

/**
 * ProductInput resource — the writable product format.
 * Write to productInputs, read from products.
 */
export interface GmcProductInput {
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  productAttributes: GmcProductAttributes;
  /** Resource name, set by API on response. */
  name?: string;
}

/** Response from productInputs:insert. */
export interface GmcInsertResponse {
  name: string;
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  productAttributes: GmcProductAttributes;
}

/** Error from Merchant API. */
export interface GmcError {
  code: number;
  message: string;
  status?: string;
}

/** OAuth token pair stored in Wix Secrets Manager. */
export interface GmcTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  merchantId: string;
  dataSourceId?: string;
}

/** Configuration for GMC OAuth (loaded from environment/secrets). */
export interface GmcOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

/** Result of a single product insert attempt. */
export interface GmcInsertResult {
  offerId: string;
  success: boolean;
  name?: string;
  error?: string;
}
