import { extensions } from '@wix/astro/builders';

export default extensions.dashboardPage({
  id: 'a1b2c3d4-1111-4000-8000-000000000001',
  title: 'Connect',
  routePath: '/connect',
  component:
    './extensions/dashboard/pages/connect/connect.tsx',
});
