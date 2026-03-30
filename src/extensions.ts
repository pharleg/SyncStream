import { app } from '@wix/astro/builders';
import connect from './extensions/dashboard/pages/connect/connect.extension.ts';
import mapping from './extensions/dashboard/pages/mapping/mapping.extension.ts';
import status from './extensions/dashboard/pages/status/status.extension.ts';
import settings from './extensions/dashboard/pages/settings/settings.extension.ts';

export default app()
  .use(connect)
  .use(mapping)
  .use(status)
  .use(settings)
