# Initial storybloq Setup

## Session Summary

Initialized storybloq for sync-stream on 2026-05-01. Project was already 231 commits in with 4 phases substantially complete.

## Project Profile

- **Name**: sync-stream (SyncStream)
- **Type**: Wix App Market application
- **Language**: TypeScript
- **Stack**: Wix CLI + Astro + React + TypeScript, Wix Design System, Node.js serverless backend
- **Version**: 4.28.0 (npm), Wix App ID: 6eb9d379-bb51-4edf-8946-60d6f6344b20

## Phase Decisions

Created 6 phases reflecting actual development trajectory:

| Phase | Status | Rationale |
|-------|--------|-----------|
| p1: foundation | complete (no tickets) | Wix CLI scaffold, data model, permissions — done |
| p2: gmc-mvp | complete (no tickets) | GMC OAuth, productMapper, validator, gmcClient — done |
| p3: incremental-sync | complete (no tickets) | Webhook handlers, SyncState writes, status dashboard — done |
| p4: compliance-workbench | complete (no tickets) | rulesEngine, filterEngine, FixWizard, AI enhancement — done |
| p5: meta-billing | active | Meta OAuth, dual-platform sync, billing, platform UI |
| p6: app-market-launch | upcoming | Field mapping, App Market listing, QA, launch cleanup |

Phases p1–p4 have no tickets because the work is already implemented in the codebase (231 commits). Creating retrospective tickets for completed work was deemed unnecessary overhead.

## Ticket Dependencies (p5–p6)

- T-001 → T-002 → T-004 (Meta OAuth unlocks sync, sync unlocks platform targeting UI)
- T-002 → T-007 (Meta mapper tests depend on wired Meta sync)
- T-005 → T-006 (field mapping UI should be in screenshots before App Market submission)
- T-006 + T-007 → T-009 (final cleanup is last)
- T-003, T-005, T-008 are independent (no blockers)

## Decisions Pending

1. **Meta OAuth callback host**: Same Cloudflare Worker as GMC or a separate worker? GMC pattern is the reference — likely same worker with path routing.
2. **Billing tier structure**: Exact plan names and product count limits per tier not yet decided.

## Setup Choices

- Quality pipeline: not configured (user did not go through quality gate — existing project with vitest already set up)
- storybloq entries added to .gitignore (.story/snapshots/, .story/sessions/, .story/status.json)
