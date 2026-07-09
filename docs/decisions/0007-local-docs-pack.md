# Decision 0007: Local Docs Pack

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Docs-pack system design (Alpha 0)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/docs-pack.md`, `docs/package-policy.md`,
  `docs/sandbox.md`, `docs/stack-snapshots.md`, issues #3, #4, #5, #6,
  #8, #9, #10

> Note: the issue body suggested `0006-local-docs-pack.md`, but `0006`
> is already used by the package allowlist policy decision. This decision is
> numbered `0007`.

## Context

Issue #7 designs the OAF local docs pack so agents can work internet-off
during normal plan / edit / test / build modes. If OAF disables internet
for safety (decision 0005), the agent still needs reliable stack docs for
the exact versions OAF supports. Random memory or web search is not an
acceptable substitute.

This couples tightly to decision 0006 (docs must align with allowed
package versions) and decision 0003 / #14 (docs tied to stack snapshots).

## Decision

1. **Normal OAF plan / edit / test / build work should be possible
   internet-off.**
2. **Agents should prefer OAF local docs** over memory or live web search.
3. **Docs packs are versioned** and aligned with OAF stack snapshots.
4. **Docs packs are aligned with allowed package versions** (package policy).
5. **Docs for the wrong major version are not acceptable guidance.**
6. **The OAF repo owns docs packs**; generated apps record which docs
   pack they were created with.
7. **Generated apps should not copy the full docs pack** in Alpha 0.
8. **Generated apps should record a docs-pack marker under `oaf/`.**
9. **Docs packs should be source-linked** and include retrieval / version
   metadata.
10. **Docs packs should be LLM-readable first**: Markdown chunks plus
    manifest metadata for Alpha 0.
11. **JSONL / SQLite / vector indexes are future optimizations**, not Alpha 0
    requirements.
12. **Docs pack updates happen through explicit stack / docs-pack
    updates**, not casual agent edits.
13. **Research mode may refresh docs packs later**, but normal agent work
    should use local docs.
14. **Docs pack generation / update tooling is future work.**
15. **OAF docs / conventions are part of the docs pack**, not just
    third-party docs.

### Storage decision (OAF repo owns packs)

```text
docs-packs/
  stack-0.1/
    manifest.json
    oaf/
      doctrine.md
      conventions.md
      forbidden-patterns.md
    nextjs/  react/  typescript/  drizzle/  better-auth/
    postgres/  zod/  tailwind/  vitest/  playwright/
    deployment/
      docker.md
      coolify.md
```

Generated apps record docs-pack metadata under `oaf/docs-pack.json`:

```json
{
  "docsPack": "stack-0.1",
  "oafStack": "0.1.0"
}
```

(The issue draft suggested `oaf/docs-pack/` and `blueprint.md`; this
decision uses the canonical `docs-packs/stack-0.1/` layout and the
`oaf/docs-pack.json` marker consistent with the #4 app structure and #3
stack snapshot `oafStack` field.)

### Chunk metadata

Each chunk carries: `source`, `source_url`, `version`, `retrieved_at`,
`hash`, `applies_to`, `summary`, `license_notes`. The manifest concept
records `docsPack`, `oafStack`, `createdAt`, and a `sources` list. These
are **documented concepts**, not implemented files (per task scope).

### Agent lookup behavior

Read OAF doctrine/conventions first → identify relevant areas → consult
local docs-pack chunks before editing → use research mode only when local
docs are missing/stale or the user approves → cite when relying on docs →
stop and report if local docs conflict with pinned versions.

Alpha 0 lookup is simple filesystem / topic / keyword / manifest lookup.
Future: `oaf docs search`, `oaf docs explain`, JSONL / SQLite / vector
indexes.

### Normal internet-off workflow

Plan/Edit/Test = no network; Browser review = localhost only; Research =
network on, read-only, approved; Install = network on for approved
dependency ops only.

## Consequences

- Agents have a version-correct offline knowledge source, satisfying the
  safety stance (decision 0005) without forcing web reliance.
- Docs packs stay version-aligned with the allowlist (decision 0006) and
  stack snapshots (decision 0003), so guidance can't silently drift to a
  wrong major version.
- Generated apps stay light (marker only, no full pack copy) in Alpha 0.

## Confirmed deferred to later issues

- **Actual docs-pack content creation** → future work.
- **Docs-pack generation / update tooling** → future work.
- **Minimal `oaf init`** (writes markers, references pack) → #8.
- **Sandbox runner enforcement** → #9.
- **Build receipt format** (docs-pack changes receipted) → #10.
- **Package allowlist machine-readable implementation** → future `oaf-core`
  config (from #6 / #14).
