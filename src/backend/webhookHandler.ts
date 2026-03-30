/**
 * webhookHandler.ts
 *
 * Handles Wix product webhooks (product.created, product.updated,
 * product.deleted). Must verify event signature before processing.
 */

export async function handleProductCreated(
  _payload: unknown,
): Promise<void> {
  // TODO Phase 3: implement
  throw new Error('Not implemented');
}

export async function handleProductUpdated(
  _payload: unknown,
): Promise<void> {
  // TODO Phase 3: implement
  throw new Error('Not implemented');
}

export async function handleProductDeleted(
  _payload: unknown,
): Promise<void> {
  // TODO Phase 3: implement
  throw new Error('Not implemented');
}
