# Repository Organization and Ownership

This repository is organized by **application**, **domain**, **infrastructure**, and **documentation** concerns.

## Ownership map

- `app/`
  - Next.js route entry points, API route handlers, and UI feature composition.
- `app/features/`
  - Route-focused client UI modules (chat and tickets).
- `app/types/`
  - Shared UI-facing types for feature pages.
- `src/application/`
  - Use-case orchestration and API-facing service boundaries.
  - `src/application/agents/`: intake → knowledge → workflow → escalation graph.
  - `src/application/api/`: stable server-side interfaces used by route handlers.
- `src/domain/`
  - Business entities and domain data concerns.
  - `src/domain/data/`: ticket model/store and knowledge-base chunks.
- `src/infrastructure/`
  - External integrations and technical adapters.
  - `src/infrastructure/lib/`: LLM, vector store, Jira client, metrics.
  - `src/infrastructure/mcp/`: MCP server + tool catalog.
- `scripts/`
  - Operational entrypoints (ingestion and standalone MCP server).
- `tests/`
  - End-to-end scenario tests.
- `docs/`
  - Architecture, operations, research, demo collateral, and KB source docs.

## Placement rules

- Put new orchestration/use-case logic in `src/application/*`.
- Put business rules and domain data shape changes in `src/domain/*`.
- Put vendor/API/database/protocol adapters in `src/infrastructure/*`.
- Keep route files thin; place UI logic in `app/features/*`.
- Keep ingestion source content in `docs/kb/*`.

## Compatibility notes

Legacy paths under `src/agents`, `src/data`, `src/lib`, and `src/mcp` are retained as compatibility re-exports during migration.
