import { products } from '@wix/stores';
import { syncProduct } from '../../../../backend/syncService';
import { getAppConfig } from '../../../../backend/dataService';

export default products.onProductCreated(async (event) => {
  const productId = event.data?.productId;
  const instanceId = event.metadata?.instanceId;
  if (!productId || !instanceId) return;

  const config = await getAppConfig(instanceId);
  if (!config?.syncEnabled) return;

  const platforms: ('gmc' | 'meta')[] = [];
  if (config.gmcConnected) platforms.push('gmc');
  if (config.metaConnected) platforms.push('meta');
  if (platforms.length === 0) return;

  await syncProduct(instanceId, productId, platforms);
});
