import { app } from '@wix/astro/builders';
import syncStream from './extensions/dashboard/pages/sync-stream/sync-stream.extension.ts';

export default app()
  .use(syncStream)
