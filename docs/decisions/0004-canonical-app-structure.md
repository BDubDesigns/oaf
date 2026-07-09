# Decision 0004: Canonical App Structure

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Generated app structure (Alpha 0)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/app-structure.md`, `docs/stack.md`,
  `docs/stack-snapshots.md`, issues #3, #5, #6, #7, #8, #9, #10

## Context

Issue #4 is one of the most important Alpha 0 issues: the folder structure
is what lets an agent know where to look in a fresh session. The repo layout
is the API. OAF's doctrine says agents must not invent architecture; the
generated app structure is therefore product surface area, not an
implementation detail.

The issue body contains a *draft* shape (with `src/`, `commands/queries/`,
and `oaf/blueprint.md` style metadata). This decision records the
**authoritative Alpha 0 structure** given by the implementation brief, which
supersedes that draft.

## Decision

1. **Generated OAF apps are single-app repos in Alpha 0, not monorepos.**
2. **OAF uses Next.js App Router**, so routes/layouts live under `app/`.
3. **`components/`** is for shared UI only (`ui/` primitives, `shared/`
   app-specific).
4. **`features/`** is for product/domain features, colocated with their
   local components, server logic, schemas, types, and an `index.ts`.
5. **`lib/`** is for small shared utilities, not business-logic dumping.
6. **`server/`** is for server-only application logic shared across
   features/routes (auth, actions). Not importable by client components.
7. **`db/`** is for schema, migrations, seed data, and client setup.
8. **`tests/`** is for unit/integration tests (mirroring source where
   helpful).
9. **`e2e/`** is for Playwright browser/e2e/visual smoke tests.
10. **`docs/`** is for app-specific human documentation (not OAF's repo
    docs).
11. **`oaf/`** is for OAF-owned metadata, stack snapshot info, and
    receipts — part of the generated-app contract.
12. **Generated apps commit `package.json`, `pnpm-lock.yaml`, and config
    files** because reproducibility is part of the product.
13. **Agents should not create new top-level directories casually.**
14. **Agents should not casually edit `oaf/stack.json`, lockfiles,
    database schema, or dependency files** without the relevant policy /
    check / receipt.
15. **App structure optimizes for predictable agent navigation** over
    maximum framework flexibility.

The full tree and per-directory ownership live in `docs/app-structure.md`,
including naming conventions (feature folders, tables, schema files,
components, routes, tests, env vars, `Result` handling, barrels) and the
explicitly rejected patterns (monorepos, arbitrary top-level folders,
package-by-layer complexity).

## Consequences

- An agent starting a fresh session can predict where auth, schema,
  features, components, tests, docs, receipts, and deployment files live.
- The structure is fixed by the factory, satisfying doctrine §5 (no invented
  architecture) and §3 (strict conventions as a feature).
- `oaf/` becomes a stable home for stack-snapshot info (`stack.json`) and
  receipts, read by later issues #8 and #10.

## Confirmed deferred to later issues

- **Exact generated file contents** → #8 (`oaf init`).
- **Sandbox command policy** → #5.
- **Package allowlist / dependency-addition rules** → #6.
- **Docs pack format** → #7.
- **Build receipt format** → #10.
- **Exact machine-readable JSON schemas** for `oaf/app.json`,
  `oaf/stack.json`, and receipts → finalized during #8 / #10.
