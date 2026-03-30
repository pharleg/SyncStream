/** Product entry for the Meta Graph API Catalog. */
export interface MetaProduct {
  id: string;
  title: string;
  description: string;
  availability: 'in stock' | 'out of stock';
  condition: 'new' | 'refurbished' | 'used';
  price: string; // e.g. '1499 USD'
  link: string;
  imageLink: string;
  brand: string;
  retailerId: string;
}

/** Response from a Meta Catalog product create/update. */
export interface MetaCatalogResponse {
  id: string;
  success: boolean;
  errors?: MetaError[];
}

export interface MetaError {
  code: number;
  message: string;
  type: string;
}

/** OAuth token pair stored in Wix Secrets Manager. */
export interface MetaTokens {
  accessToken: string;
  expiresAt: number;
  catalogId: string;
}
