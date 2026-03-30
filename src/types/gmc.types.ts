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
