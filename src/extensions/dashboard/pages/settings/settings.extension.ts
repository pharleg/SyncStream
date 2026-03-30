import { extensions } from '@wix/astro/builders';

export default extensions.dashboardPage({
  id: 'a1b2c3d4-4444-4000-8000-000000000004',
  title: 'Settings',
  routePath: '/settings',
  component:
    './extensions/dashboard/pages/settings/settings.tsx',
});
