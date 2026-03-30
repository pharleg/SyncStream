import { products } from '@wix/stores';
import { deleteProduct as deleteGmcProduct } from '../../../../backend/gmcClient';
import { getValidGmcAccessToken, getGmcTokens } from '../../../../backend/oauthService';
import { getAppConfig, upsertSyncState } from '../../../../backend/dataService';
import type { SyncState } from '../../../../types/wix.types';

export default products.onProductDeleted(async (event) => {
  const productId = event.metadata?.entityId;
  const instanceId = event.metadata?.instanceId;
  if (!productId || !instanceId) return;

  const config = await getAppConfig(instanceId);
  if (!config?.syncEnabled) return;

  // Delete from GMC if connected
  if (config.gmcConnected) {
    try {
      const accessToken = await getValidGmcAccessToken(instanceId);
      const tokens = await getGmcTokens(instanceId);
      await deleteGmcProduct(tokens.merchantId, productId, accessToken);

      const syncState: SyncState = {
        productId,
        platform: 'gmc',
        status: 'synced',
        lastSynced: new Date(),
        errorLog: null,
        externalId: '',
      };
      await upsertSyncState(syncState);
    } catch (error) {
      const syncState: SyncState = {
        productId,
        platform: 'gmc',
        status: 'error',
        lastSynced: new Date(),
        errorLog: [{
          field: 'api',
          platform: 'gmc',
          message: error instanceof Error ? error.message : 'Delete failed',
          productId,
        }],
        externalId: '',
      };
      await upsertSyncState(syncState);
    }
  }
});
