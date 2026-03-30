import { type FC, useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  Dropdown,
  FormField,
  Input,
  Page,
  Text,
  Loader,
  SectionHelper,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';

interface FieldMapping {
  type: 'customField' | 'default';
  wixField?: string;
  defaultValue?: string;
}

type FieldMappings = Record<string, FieldMapping>;

interface MappingField {
  key: string;
  label: string;
  description: string;
  placeholder: string;
}

const MAPPING_FIELDS: MappingField[] = [
  { key: 'siteUrl', label: 'Site URL', description: 'Your store base URL (e.g. https://www.example.com)', placeholder: 'https://www.example.com' },
  { key: 'brand', label: 'Brand', description: 'Product brand name for GMC', placeholder: 'Your Brand Name' },
  { key: 'condition', label: 'Condition', description: 'Product condition (new, refurbished, used)', placeholder: 'new' },
  { key: 'gtin', label: 'GTIN / UPC', description: 'Global Trade Item Number — map to a Wix custom field if products have barcodes', placeholder: 'barcode' },
  { key: 'mpn', label: 'MPN', description: 'Manufacturer Part Number — map to a Wix custom field if available', placeholder: 'mpn' },
  { key: 'googleProductCategory', label: 'Google Product Category', description: 'Google taxonomy category (e.g. "Apparel & Accessories > Clothing")', placeholder: 'Apparel & Accessories > Clothing' },
];

const TYPE_OPTIONS = [
  { id: 'default', value: 'Static Default' },
  { id: 'customField', value: 'Wix Custom Field' },
];

async function fetchMappings(): Promise<FieldMappings> {
  const response = await fetch('/api/app-config?instanceId=default');
  if (!response.ok) return {};
  const config = await response.json();
  return config?.fieldMappings ?? {};
}

async function saveMappings(mappings: FieldMappings): Promise<void> {
  const response = await fetch('/api/app-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId: 'default', fieldMappings: mappings }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error ?? 'Failed to save');
  }
}

const MappingPage: FC = () => {
  const [mappings, setMappings] = useState<FieldMappings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchMappings()
      .then(setMappings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateMapping = useCallback(
    (key: string, update: Partial<FieldMapping>) => {
      setMappings((prev) => ({
        ...prev,
        [key]: { ...prev[key], ...update } as FieldMapping,
      }));
      setSuccess(false);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await saveMappings(mappings);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [mappings]);

  if (loading) {
    return (
      <WixDesignSystemProvider features={{ newColorsBranding: true }}>
        <Page>
          <Page.Content>
            <Box align="center" padding="60px">
              <Loader />
            </Box>
          </Page.Content>
        </Page>
      </WixDesignSystemProvider>
    );
  }

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="Field Mapping"
          subtitle="Configure how Wix product fields map to GMC requirements"
          actionsBar={
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Mappings'}
            </Button>
          }
        />
        <Page.Content>
          <Box direction="vertical" gap="18px">
            {error && (
              <SectionHelper appearance="danger">{error}</SectionHelper>
            )}
            {success && (
              <SectionHelper appearance="success">
                Mappings saved successfully.
              </SectionHelper>
            )}

            {MAPPING_FIELDS.map((field) => {
              const mapping = mappings[field.key] ?? { type: 'default' as const };
              return (
                <Card key={field.key}>
                  <Card.Header title={field.label} subtitle={field.description} />
                  <Card.Divider />
                  <Card.Content>
                    <Box gap="12px" verticalAlign="bottom">
                      <Box width="200px">
                        <FormField label="Mapping Type">
                          <Dropdown
                            size="small"
                            options={TYPE_OPTIONS}
                            selectedId={mapping.type ?? 'default'}
                            onSelect={(option) =>
                              updateMapping(field.key, {
                                type: option.id as 'default' | 'customField',
                              })
                            }
                          />
                        </FormField>
                      </Box>
                      <Box grow={1}>
                        <FormField
                          label={
                            mapping.type === 'customField'
                              ? 'Wix Field Key'
                              : 'Default Value'
                          }
                        >
                          <Input
                            size="small"
                            placeholder={field.placeholder}
                            value={
                              mapping.type === 'customField'
                                ? mapping.wixField ?? ''
                                : mapping.defaultValue ?? ''
                            }
                            onChange={(e) =>
                              updateMapping(field.key, {
                                ...(mapping.type === 'customField'
                                  ? { wixField: e.target.value }
                                  : { defaultValue: e.target.value }),
                              })
                            }
                          />
                        </FormField>
                      </Box>
                    </Box>
                  </Card.Content>
                </Card>
              );
            })}
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default MappingPage;
