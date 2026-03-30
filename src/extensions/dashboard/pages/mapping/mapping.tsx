import type { FC } from 'react';
import { EmptyState, Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

const MappingPage: FC = () => {
  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Field Mapping"
          subtitle="Map your Wix product fields to GMC and Meta requirements"
        />
        <Page.Content>
          <EmptyState
            title="Field Mapping"
            subtitle="Configure how your product data maps to each platform."
            skin="page"
          />
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default MappingPage;
