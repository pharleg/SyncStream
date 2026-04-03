# Wix Feed Sync -- Project Context

## Autonomy
Do not ask for permission before running commands, executing curl requests, writing files,
installing packages, or making any other changes within this repo. Just do it and report
what you did. Only stop and ask if you hit an ambiguous decision that affects architecture
or scope -- not for routine execution.

## What You're Building
SyncStream is a Wix App Market application that syncs Wix Store products to
Google Merchant Center (GMC) and Meta Product Catalog. Merchants install the app, connect their
GMC and Meta accounts via OAuth, and the app handles initial feed generation,
ongoing incremental sync via Wix product webhooks, and pre-push compliance
validation.

## Tech Stack
- Framework: Wix CLI (React + TypeScript, deployed to Wix cloud)
- UI: Wix Design System (@wix/design-system) -- no external UI libraries
- Backend: Node.js (Wix-hosted serverless, CLI-managed)
- Data access: Wix JavaScript SDK (Stores Products API)
- Product events: Wix webhooks (product.created, product.updated, product.deleted)
- Google: Content API for Shopping v2.1 (OAuth2)
- Meta: Graph API Catalog API (OAuth2)
- Secrets: Wix Secrets Manager (all tokens stored here, never hardcoded)
- State: Wix Data collections (SyncState, AppConfig)
- Version control: Git

## Directory Structure
syncstream/
src/
  dashboard/
    pages/
      connect/
        connect.extension.ts
        connect.tsx
      mapping/
        mapping.extension.ts
        mapping.tsx
      status/
        status.extension.ts
        status.tsx
      settings/
        settings.extension.ts
        settings.tsx
backend/
  syncService.ts
  productMapper.ts
  validator.ts
  gmcClient.ts
  metaClient.ts
  webhookHandler.ts
  oauthService.ts
types/
  wix.types.ts
  gmc.types.ts
  meta.types.ts
  sync.types.ts
package.json
wix.config.json
CLAUDE.md
README.md


## Architecture Rules
- All external API calls (GMC, Meta) live in gmcClient.ts and metaClient.ts only.
  No direct fetch calls elsewhere.
- syncService.ts is the only orchestrator -- it calls productMapper, validator,
  gmcClient, and metaClient. Nothing else should.
- Dashboard pages call backend functions only. No direct Wix SDK calls from the
  frontend.
- All secrets go through Wix Secrets Manager. Never log tokens.
- Webhook handler must verify Wix event signature before processing.
- All sync operations must be idempotent (pushing a product twice = no duplicate).
- TypeScript strict mode throughout.

## Required App Permissions
Set these in Wix App Dashboard > Permissions:
- Manage Stores -- All Permissions
- Read Stores -- All Permissions
- Manage Secrets
- Wix Data -- Read and Write

## Wix Data Collections
Create these before any sync logic:

SyncState:
  productId (string), platform (string: 'gmc' | 'meta'),
  status (string: 'synced' | 'error' | 'pending'),
  lastSynced (date), errorLog (json), externalId (string)

AppConfig:
  instanceId (string), gmcConnected (bool), metaConnected (bool),
  fieldMappings (json), syncEnabled (bool), lastFullSync (date)

## GMC Required Fields
gid, title, description (HTML stripped), link, image_link,
availability (in_stock/out_of_stock), price (e.g. '14.99 USD'),
brand, gtin/mpn (from custom Wix fields -- merchant maps these),
condition ('new' default), shipping (GMC account-level or per-product)

## Meta Required Fields
id, title, description (HTML stripped), availability, condition,
price ('1499 USD' format -- cents-string), link, image_link,
brand, retailer_id

## Validator Behavior
validator.ts checks each product against the target platform's required
field list before any push. Products with missing/malformed fields get a
structured error: { field, platform, message, productId }.
Valid products push. Invalid products are flagged in SyncState.
Batch does NOT abort for one bad product.

## Field Mapping Notes
brand, gtin, and mpn don't exist as native Wix fields. The Mapping UI
(Phase 5) needs to support:
1. Mapping to existing Wix custom product fields
2. Store-level defaults (e.g. condition: 'new' for all products)
Design the data model in Phase 1 to accommodate this -- fieldMappings
in AppConfig should be flexible enough to hold both types.

## Secrets Manager Keys
All secrets stored in Wix Secrets Manager:
- gmc_access_token_{instanceId} -- GMC OAuth access token
- gmc_refresh_token_{instanceId} -- GMC OAuth refresh token
- meta_access_token_{instanceId} -- Meta OAuth access token
- meta_refresh_token_{instanceId} -- Meta OAuth refresh token
- supabase_project_url -- Supabase project URL
- supabase_service_role -- Supabase service role key
- anthropic_api_key -- Anthropic Claude API key (for AI description enhancement)

## OAuth Flow
Connect page triggers OAuth for each platform. Backend exchanges auth
code for access + refresh tokens. Tokens stored in Secrets Manager
under namespaced keys (see above).
All API calls use stored refresh token to get short-lived access tokens.

## Build Phases
Phase 1: CLI init, scaffold, permissions, Data collections, AppConfig model
Phase 2: GMC OAuth, productMapper (GMC), validator (GMC), gmcClient, full sync
Phase 3: webhookHandler, incremental sync, SyncState writes, status dashboard
Phase 4: Meta OAuth, productMapper (Meta), metaClient, dual-platform sync
Phase 5: Mapping UI, per-field override, merchant custom field support
Phase 6: Error UX polish, manual sync trigger, App Market listing, billing

Phase 2 is a shippable GMC-only MVP. You can stop there and release.

## Post-Architecture Feature Decisions

### SKU Handling
- If SKU present on product/variant, use it as the GMC `id`
- If SKU absent, generate stable fallback: `parentId_variantId`
- Surface missing SKUs in Sync Status dashboard as a warning-level flag (not a blocker)
- `validator.ts` handles this as a warning, not an error

### Compliance Checks (Phase 3)
- Expose validator output as a standalone compliance feature, not just a pre-push side effect
- Merchant can trigger "Check Now" without initiating a sync
- Feed health score: % of catalog compliant per platform, surfaced on dashboard
- Implementation: read SyncState + re-run validator on current catalog snapshot --
  no GMC/Meta API calls required

### Per-Product Platform Targeting
- Merchant can select which platforms each product syncs to: All, GMC only, Meta only
- `SyncState` gets a `platforms` field (string array, e.g. `['gmc', 'meta']`)
- Default is all connected platforms
- `webhookHandler` and `syncService` check `platforms` before pushing to any platform
- Deselecting a platform stops future syncs; no delete call required --
  GMC expires stale products ~24hrs, Meta ~30 days
- UI: toggles per product on the Sync Status page, with bulk selection support

### Product Images in Workbench
- Surface product images alongside sync/compliance data in the product workbench
- Merchant can visually verify the image being pushed to GMC/Meta before or after sync
- Pull from `product.media.mainMedia.image.url` (already a mapped field)

### Compliance Fix Staging (added Apr 2)
- Compliance issues with fixable fields (brand, description, title, condition, link,
  imageLink, offerId/SKU) show a "Fix" button in the workbench
- Merchant enters corrected value → staged locally → pending fixes banner appears
- "Apply to Wix" writes fixes back to Wix products
- "Apply to GMC" applies as overrides for next sync
- "Apply to Both" does both
- Tab change warning if uncommitted fixes exist

## Wix Docs
Wix CLI docs are available in machine-readable format.
Append .md to any docs URL at dev.wix.com to get the Markdown version.
llms.txt index: https://dev.wix.com/docs/llms.txt

## Notes
- Node.js v20.11.0+ required for Wix CLI
- Use `wix generate dashboard-page` for each page extension
- Wix Design System components: @wix/design-system
- Test with `wix dev` against a development site with Wix Stores installed
- Re-install the app on the test site after adding new permissions

## Reference Implementation: LECC Google Merchant Feed
https://github.com/pharleg/lecc-google-merchant-feed

This is a working Python-based GMC feed generator built for Lake Erie Clothing Company
(the origin project for SyncStream). Not portable directly -- different language, different
runtime, store-specific hardcodes -- but contains validated real-world knowledge worth
referencing when building productMapper.ts and gmcClient.ts:

### Wix API endpoints that actually work
- Category items: POST `https://www.wixapis.com/categories/v1/categories/{id}/list-items`
  - Body: `{ treeReference: { appNamespace: '@wix/stores' }, paging: { limit: 100, cursor? } }`
  - Pagination via `pagingMetadata.cursors.next`
- Products by ID: POST `https://www.wixapis.com/stores/v3/products/query`
  - Body: `{ query: { filter: { id: { $in: [...ids] } }, paging: { limit: 100 } } }`
- Product detail: GET `https://www.wixapis.com/stores/v3/products/{productId}`
  - Returns full product including `variantsInfo`

### Variant/option resolution
Variants are under `product.variantsInfo.variants`. Each variant has a `choices` array
where each entry has `optionChoiceIds: { optionId, choiceId }`. To get human-readable
color/size names, resolve against `product.options[].choicesSettings.choices[]`.
See `get_choice_name()` in generate_feed.py for the exact lookup logic.

### Price path fallback chain
Wix product price is inconsistently nested across API versions. Try in order:
1. `product.actualPriceRange.minValue.amount`
2. `product.priceData.price`
3. `product.price.price`

### item_group_id pattern
For products with multiple variants, set `item_group_id = product.id` on all variant rows.
For single-variant products, leave it empty. This is required by GMC for apparel.

### category_map.json
The repo includes a keyword-to-Google-taxonomy mapping file. This is the seed data
for SyncStream's category mapping feature (Phase 5). Port to TypeScript and make it
merchant-configurable rather than hardcoded.
