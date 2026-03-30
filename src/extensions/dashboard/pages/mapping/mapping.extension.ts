import { extensions } from '@wix/astro/builders';

export default extensions.dashboardPage({
  id: 'a1b2c3d4-2222-4000-8000-000000000002',
  title: 'Field Mapping',
  routePath: '/mapping',
  component:
    './extensions/dashboard/pages/mapping/mapping.tsx',
});
