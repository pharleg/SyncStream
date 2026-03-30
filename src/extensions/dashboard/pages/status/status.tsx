import type { FC } from 'react';
import { EmptyState, Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

const StatusPage: FC = () => {
  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Sync Status"
          subtitle="Monitor the status of your product syncs"
        />
        <Page.Content>
          <EmptyState
            title="Sync Status"
            subtitle="View sync progress, errors, and history across platforms."
            skin="page"
          />
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default StatusPage;
