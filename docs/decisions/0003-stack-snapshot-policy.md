# Decision 0003: Stack Snapshot Policy

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Dependency versioning / reproducibility policy (Alpha 0)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/stack-snapshots.md`, `docs/stack.md`,
  `docs/decisions/0002-blessed-stack-v0.md`, issues #3, #6, #7, #8

## Context

Issue #14 defines how OAF chooses exact dependency versions and how
generated apps preserve a reproducible dependency graph. It is distinct from
#3 (which blessed the stack categories) and #6 (which will own the package
allowlist / dependency-addition policy).

OAF's doctrine is that strict conventions are a feature and agents must not
install random packages (decision 0001, doctrine §6). That makes dependency
selection and lockfile handling **security-relevant policy**, not casual
agent behavior. Upstream packages commonly declare dependencies with semver
ranges, so OAF cannot assume the resolved tree is reproducible. We need an
explicit snapshot model.

## Decision

1. **OAF does not trust upstream packages to pin their dependency trees.**
   Generated apps carry their own reproducibility boundary.
2. **Generated apps use exact direct dependency versions** (no caret /
   tilde ranges in the generated manifest).
3. **Generated apps commit a lockfile** capturing the full resolved graph
   (pnpm: `pnpm-lock.yaml`).
4. **Generated apps use frozen installs by default**
   (`pnpm install --frozen-lockfile`).
5. **Package manager and Node versions are pinned.**
6. **Docker / Postgres image versions are pinned** (exact minor tag).
7. **Newly published package versions are delayed** before inclusion.
8. **Package additions are allowlist-based** (owned by #6).
9. **Stack changes happen via explicit OAF stack upgrades**, not casual
   `pnpm update`.
10. **Dependency changes are security-relevant** and must be receipted
    (issue #10).

### Version selection policy

- Do not pin "whatever is latest today."
- Prefer LTS runtimes with the longest practical support runway.
- Prefer the current supported database major with an exact minor image tag.
- Normal dependencies: at least **7–14 days old** before inclusion.
- Foundational dependencies: at least **30 days old** before inclusion.
- No beta / canary / rc versions in the default stack.
- No `@latest` in generated apps.
- Prefer modern, lightweight, high-performance packages once mature.

### OAF Stack 0.1

The first explicit snapshot is **OAF Stack 0.1** (version `0.1.0`).
Generated apps record it, e.g. `{ "oafStack": "0.1.0" }`.

The original candidate version table from issue #14 research was captured in
`docs/stack-snapshots.md`. It is historical only: issue #44 completed final
official-source verification, release-age review, and a temporary compatibility
probe. `config/stack/oaf-stack-0.1.json` is now the locked authority; see
`docs/stack-0.1-verification.md` for evidence.

Key directional calls:

- **Node 24 LTS** (not 22) for the longest practical support runway.
- **Postgres 18** (not 17) as the current supported major.
- **Tailwind CSS 4** (not v3) as the styling baseline; the locked exact
  Tailwind/PostCSS pair lives in `config/stack/oaf-stack-0.1.json`.
- **TypeScript 6** initially, with **TypeScript 7** named as a likely
  early stack-upgrade target once mature enough.

## Consequences

- Generated apps are reproducible regardless of upstream semver drift.
- Lockfile diffs become a first-class, security-relevant review surface.
- Agents cannot silently change the dependency graph; upgrades are explicit
  and receipted.
- The relationship to sibling issues is now explicit: #3 what, #6
  allowlist, #14 how/versions, #7 docs-pack alignment, #8 implementation.

## Confirmed deferred to later issues

- **Future Stack 0.1 upgrades** → explicit successor snapshot work; the
  candidate-table lock is complete in issue #44.
- **Package allowlist format and dependency-addition / update rules** → #6.
- **Docs pack version alignment with pinned dependencies** → #7.
- **Exact canonical folder layout** → #4.
- **Exact generated app implementation and the `oaf update-stack` path** → #8.
- **Receipt format for dependency changes** → #10.
