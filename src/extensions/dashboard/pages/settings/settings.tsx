import type { FC } from 'react';
import { EmptyState, Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

const SettingsPage: FC = () => {
  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Settings"
          subtitle="Configure your SyncStream preferences"
        />
        <Page.Content>
          <EmptyState
            title="Settings"
            subtitle="Manage sync preferences and app configuration."
            skin="page"
          />
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default SettingsPage;
