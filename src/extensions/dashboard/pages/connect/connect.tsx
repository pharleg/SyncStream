import type { FC } from 'react';
import { EmptyState, Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

const ConnectPage: FC = () => {
  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Connect"
          subtitle="Connect your Google Merchant Center and Meta accounts"
        />
        <Page.Content>
          <EmptyState
            title="Connect Your Accounts"
            subtitle="Link your GMC and Meta accounts to start syncing products."
            skin="page"
          />
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default ConnectPage;
