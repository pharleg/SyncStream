import { extensions } from '@wix/astro/builders';

export default extensions.dashboardPage({
  id: 'a1b2c3d4-3333-4000-8000-000000000003',
  title: 'Sync Status',
  routePath: '/status',
  component:
    './extensions/dashboard/pages/status/status.tsx',
});
