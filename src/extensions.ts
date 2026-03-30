import { app } from '@wix/astro/builders';
import connect from './extensions/dashboard/pages/connect/connect.extension.ts';
import mapping from './extensions/dashboard/pages/mapping/mapping.extension.ts';
import status from './extensions/dashboard/pages/status/status.extension.ts';
import settings from './extensions/dashboard/pages/settings/settings.extension.ts';
import productCreated from './extensions/backend/events/product-created/product-created.extension.ts';
import productUpdated from './extensions/backend/events/product-updated/product-updated.extension.ts';
import productDeleted from './extensions/backend/events/product-deleted/product-deleted.extension.ts';

export default app()
  .use(connect)
  .use(mapping)
  .use(status)
  .use(settings)
  .use(productCreated)
  .use(productUpdated)
  .use(productDeleted)
