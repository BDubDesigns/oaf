# Canonical OAF App Structure

This document defines the canonical folder/file structure for every OAF
generated app in Alpha 0.

Product principle:

> The repo layout is the API.

OAF apps must be predictable enough that an agent can start a fresh session,
read the OAF blueprint, and know where auth, database schema, feature
modules, queries, UI components, tests, docs, receipts, and deployment
files belong. OAF does **not** let agents invent app architecture. The
generated app structure is product surface area, not an implementation detail.

## Alpha 0 shape

Generated apps are **single-app repositories**, not monorepos.

```text
generated-app/
  app/
    layout.tsx
    page.tsx
    api/
  components/
    ui/
    shared/
  features/
    example-feature/
      components/
      server/
      schemas.ts
      types.ts
      index.ts
  lib/
    env.ts
    result.ts
    utils.ts
  server/
    auth/
    actions/
  db/
    schema/
    migrations/
    seed/
    client.ts
  tests/
    unit/
    integration/
  e2e/
  public/
  docs/
    app.md
  oaf/
    app.json
    stack.json
    receipts/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  next.config.ts
  postcss.config.mjs
  docker-compose.yml
  Dockerfile
  README.md
```

## Directory ownership

- **`app/`** — Next.js App Router routes, layouts, route handlers, and
  page-level composition. Keep route files thin; delegate real domain
  behavior to `features/`, `server/`, or `db/`.
- **`components/`** — shared UI components used across features/routes.
  `components/ui/` is for primitive/reusable UI building blocks.
  `components/shared/` is for shared app-specific components.
- **`features/`** — product/domain feature slices. Each feature may contain
  feature-local `components/`, `server/`, `schemas.ts`, `types.ts`, and an
  `index.ts` export. Colocate feature code here when it mostly belongs to
  one domain concept.
- **`lib/`** — small shared utilities and cross-cutting helpers. Must **not**
  become a dumping ground for business logic. Examples: env parsing, result
  helpers, small utility functions.
- **`server/`** — server-only application logic shared across features or
  route handlers. Examples: auth setup, server actions, shared server
  helpers. Client components must **not** import from `server/`.
- **`db/`** — database schema, migrations, seed/dev data, and database
  client setup. Schema changes must be paired with migration/update policy
  later. Agents should treat database changes as significant, receipted work.
- **`tests/`** — unit and integration tests. Mirror the source domain when
  helpful (`tests/unit/`, `tests/integration/`).
- **`e2e/`** — Playwright browser / e2e / visual smoke tests.
- **`public/`** — static assets.
- **`docs/`** — app-specific human documentation generated into each app.
  This is **not** OAF's own repo docs.
- **`oaf/`** — OAF-owned metadata, stack snapshot info, and receipts. Part
  of the generated-app contract. Do not casually edit it.

## OAF-owned metadata (`oaf/`)

`oaf/` is reserved for OAF. Suggested contents:

- `oaf/app.json` — generated-app record.
- `oaf/stack.json` — which OAF stack snapshot created the app.
- `oaf/receipts/` — receipts for meaningful work (issue #10).

Conceptual examples (schemas finalized later in #8 / #10):

```json
{
  "oafStack": "0.1.0"
}
```

```json
{
  "name": "generated-app",
  "createdBy": "oaf",
  "createdAt": "ISO_TIMESTAMP"
}
```

## Agent rules

- Agents should **not** create new top-level directories casually.
- Agents should **not** casually edit `oaf/stack.json`, lockfiles, database
  schema, or dependency files without the relevant policy / check / receipt.
- App structure should optimize for **predictable agent navigation** over
  maximum framework flexibility.

## Naming conventions

- **Feature folders:** kebab-case domain concept, e.g. `example-feature/`.
- **Database tables:** `snake_case`, plural, e.g. `users`, `feature_runs`.
- **Schema files:** kebab-case file under `db/schema/`, one table per file
  or small domain group, e.g. `users.ts`.
- **Components:** PascalCase; file matches component name, e.g. `Button.tsx`.
- **Routes:** follow Next.js App Router conventions — route folders,
  `layout.tsx`, `page.tsx`, `route.ts` for handlers.
- **Tests:** `*.test.ts(x)` under `tests/` (mirroring source) or beside the
  unit; Playwright specs `*.spec.ts` under `e2e/`.
- **Environment variables:** `UPPER_SNAKE_CASE`, parsed in `lib/env.ts`.
- **Error / result handling:** prefer a `Result` type from `lib/result.ts`
  at boundaries; avoid throwing across module boundaries where a `Result` is
  expected.
- **Barrel exports:** `index.ts` is allowed at a feature root to expose its
  public surface; keep barrels explicit and avoid deep re-export churn.

## Explicitly rejected for Alpha 0

- Monorepo generated apps.
- Arbitrary top-level folders.
- Framework-agnostic folder structures.
- Agents inventing structure per app.
- Package-by-layer complexity such as `packages/ui` / `packages/db`.
- Custom deployment folders unless later issues require them.

## Relationship to other issues

- **#3** defines the blessed stack.
- **#14** defines stack snapshots and dependency pinning.
- **#4** (this) defines where generated app files live.
- **#5** defines sandbox command policy.
- **#6** defines package allowlist / dependency-addition rules.
- **#7** defines docs pack format.
- **#8** implements minimal `oaf init`.
- **#9** implements minimal sandbox runner.
- **#10** defines build receipt format.

See also:

- `docs/stack.md`
- `docs/stack-snapshots.md`
- `docs/receipts.md` — receipts live in `oaf/receipts/`.
- `docs/decisions/0004-canonical-app-structure.md`
