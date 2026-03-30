import { app } from '@wix/astro/builders';
import syncStream from './extensions/dashboard/pages/sync-stream/sync-stream.extension.ts';
import productCreated from './extensions/backend/events/product-created/product-created.extension.ts';
import productUpdated from './extensions/backend/events/product-updated/product-updated.extension.ts';
import productDeleted from './extensions/backend/events/product-deleted/product-deleted.extension.ts';

export default app()
  .use(syncStream)
  .use(productCreated)
  .use(productUpdated)
  .use(productDeleted)
