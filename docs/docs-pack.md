# OAF Local Docs Pack

This document designs the OAF local docs pack system so agents can work
**internet-off** during normal plan / edit / test / build modes. It pairs
with `docs/package-policy.md` (docs must align with allowed package
versions) and `docs/stack-snapshots.md` (docs are tied to stack
snapshots).

Core principle:

> The agent should not rely on memory or random internet search for
> framework / package syntax.

OAF provides **versioned, source-linked, LLM-readable** docs for the
blessed stack and OAF conventions.

## Purpose

If OAF intentionally disables internet for safety (see `docs/sandbox.md`),
the agent still needs reliable access to stack docs for the exact versions
OAF supports. The docs pack is that offline source of truth.

## Versioning and alignment

1. Normal OAF plan / edit / test / build work should be possible
   **internet-off**.
2. Agents should **prefer OAF local docs** over memory or live web search.
3. Docs packs are **versioned** and aligned with OAF stack snapshots.
4. Docs packs are aligned with **allowed package versions** from the
   package policy (`docs/package-policy.md`).
5. Docs for the **wrong major version** are **not** acceptable guidance.
6. The OAF repo **owns** docs packs; generated apps record which docs
   pack they were created with.
7. Generated apps should **not** copy the full docs pack in Alpha 0.
8. Generated apps should record a **docs-pack marker** under `oaf/`.
9. Docs packs should be **source-linked** and include retrieval / version
   metadata.
10. Docs packs should be **LLM-readable first**: Markdown chunks plus
    manifest metadata for Alpha 0.
11. **JSONL / SQLite / vector** indexes are future optimizations, not Alpha
    0 requirements.
12. Docs pack updates happen through **explicit stack / docs-pack
    updates**, not casual agent edits.
13. **Research mode** may refresh docs packs later, but normal agent work
    should use local docs.
14. Docs pack generation / update tooling is **future work**.
15. OAF docs / conventions are **part of the docs pack**, not just
    third-party docs.

## Storage (OAF repo owns packs)

```text
docs-packs/
  stack-0.1/
    manifest.json
    oaf/
      doctrine.md
      conventions.md
      forbidden-patterns.md
    nextjs/
      overview.md
      app-router.md
      route-handlers.md
      server-client-components.md
    react/
    typescript/
    drizzle/
    better-auth/
    postgres/
    zod/
    tailwind/
    vitest/
    playwright/
    deployment/
      docker.md
      coolify.md
```

## Generated-app marker

Generated apps record docs-pack metadata under `oaf/`:

```json
{
  "docsPack": "stack-0.1",
  "oafStack": "0.1.0"
}
```

(Exact schema finalized later in #8 / #10.)

## Initial docs sources

- OAF doctrine / conventions
- Next.js
- React
- TypeScript
- Drizzle
- Better Auth
- Postgres
- Zod
- Tailwind CSS
- Vitest
- Playwright
- Docker / Coolify-ready deployment notes

## Chunk metadata

Each docs chunk should eventually include:

```text
source:
source_url:
version:
retrieved_at:
hash:
applies_to:
summary:
license_notes:
```

- **`source`** — human-readable source name.
- **`source_url`** — original source URL.
- **`version`** — package / framework / doc version or version line.
- **`retrieved_at`** — when OAF captured / updated the doc.
- **`hash`** — content hash for drift detection.
- **`applies_to`** — stack / package versions this chunk applies to.
- **`summary`** — short model-readable summary.
- **`license_notes`** — notes on whether / how the docs can be
  stored / summarized.

## Manifest concept (documented, not implemented)

```json
{
  "docsPack": "stack-0.1",
  "oafStack": "0.1.0",
  "createdAt": "ISO_TIMESTAMP",
  "sources": [
    {
      "name": "nextjs",
      "version": "16.2.7",
      "path": "nextjs/",
      "sourceUrl": "https://nextjs.org/docs",
      "retrievedAt": "ISO_TIMESTAMP"
    }
  ]
}
```

This file is **conceptual** for Alpha 0; the actual manifest is future
implementation work (#8 tooling).

## Agent lookup behavior

Agents should:

1. Read OAF doctrine / conventions first when starting work.
2. Identify the relevant stack / package areas for the task.
3. Consult local docs-pack chunks **before** editing.
4. Use live **research mode** only when local docs are missing / stale or
   the user explicitly approves it.
5. Cite / report when they relied on docs-pack material.
6. **Stop and report** if local docs conflict with pinned versions.

## Lookup methods (Alpha 0 baseline)

Simple filesystem / topic lookup:

- topic / category path lookup,
- keyword search over Markdown,
- manifest metadata lookup.

Future: `oaf docs search <query>`, `oaf docs explain <package/topic>`,
JSONL chunk index, SQLite / full-text index, vector search.

## Update / versioning policy

- Docs packs are **tied to stack snapshots**.
- Docs-pack updates happen when stack snapshots or allowed package
  versions change.
- Docs for new package versions must be refreshed during stack
  upgrade / package-approval work.
- Docs-pack changes should be **receipted** later (#10).
- Docs for wrong major versions should be **rejected or quarantined**.
- Generated apps record the docs pack they were created with.

## Normal internet-off workflow

- **Plan mode:** read repo docs and local docs pack, no network.
- **Edit mode:** use local docs pack, no network.
- **Test mode:** no network.
- **Browser review mode:** localhost only.
- **Research mode:** network on, read-only, used to refresh or compare
  docs when approved.
- **Install mode:** network on only for approved dependency operations.

## Relationship to package policy

- Allowed packages should have docs-pack entries.
- Package allowlist records may reference docs-pack paths.
- Docs packs must align with allowed versions.
- If docs are missing for a package, agents should **not guess** package
  usage.

## Relationship to other issues

- **#3** blessed stack · **#14** stack snapshots/pinning · **#4** app
  structure · **#5** sandbox policy · **#6** package allowlist · **#7**
  (this) docs pack · **#8** `oaf init` · **#9** sandbox runner ·
  **#10** receipt format.

See also:

- `docs/decisions/0007-local-docs-pack.md`
- `docs/package-policy.md`
- `docs/sandbox.md`
