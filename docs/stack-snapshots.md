# OAF Stack Snapshots

This document defines how OAF chooses exact dependency versions, how it
records an **OAF stack snapshot**, and how generated apps preserve a
reproducible dependency graph.

This is policy and documentation for Alpha 0/1. Exact Stack 0.1 values are
locked in `config/stack/oaf-stack-0.1.json`; this document explains the policy
and governance around that machine-readable source of truth.

## Why snapshots exist

OAF does not trust upstream packages to pin their dependency trees for us.

React, Next.js, Drizzle, Better Auth, Tailwind, TypeScript, and others
may declare their own dependencies with semver ranges. OAF assumes upstream
manifests can allow multiple compatible transitive versions. A generated app
therefore needs its **own** reproducibility boundary, independent of whatever
ranges upstream authors happened to choose.

A stack snapshot is that boundary: a named, versioned record of the exact
pieces an OAF app is built from.

## Core reproducibility requirements (generated apps)

Every generated app must use:

- **Exact direct dependency versions** (no caret/tilde ranges in the
  generated manifest).
- A **committed lockfile** capturing the full resolved dependency graph.
- **Frozen installs by default** (`pnpm install --frozen-lockfile`).
- A **pinned package manager version**.
- A **pinned Node version**.
- **Pinned Docker / Postgres image versions**.
- **Delayed adoption** of newly published package versions.
- **Allowlist-based package additions** (see issue #6).
- **Explicit OAF stack upgrades** instead of casual package updates.

Dependency changes are **security-relevant work**, not casual agent behavior.

## Why direct pins are not enough

Pinning direct dependencies alone does not make a build reproducible. The
unpinned transitive tree still resolves at install time, which means two
installs weeks apart can silently pull different transitive versions — and
different vulnerabilities.

That is why the lockfile is mandatory. It freezes the entire resolved graph,
direct and transitive, so the installed tree is what was reviewed. A lockfile
diff is a supply-chain diff, and OAF treats it as security-relevant.

## Version selection policy

OAF does **not** pin "whatever is latest today."

Rules for selecting versions:

- Prefer **LTS runtimes** with the longest practical support runway.
- Prefer the **current supported database major** with an exact minor image
  tag.
- **Normal dependencies** should usually be at least **7–14 days old**
  before inclusion.
- **Foundational dependencies** should preferably be at least **30 days
  old** before inclusion.
- Never use **beta / canary / rc** versions in the default stack.
- Never use `@latest` in generated apps.
- Prefer **modern, lightweight, high-performance** packages when they are
  mature enough to be safe defaults.

Foundational dependencies (subject to the 30-day preference):

- Node
- pnpm
- Next.js
- React
- TypeScript
- Postgres image
- Drizzle
- Better Auth
- Tailwind CSS
- Playwright

## Lockfile policy (pnpm)

For pnpm-generated apps:

- Commit `pnpm-lock.yaml`.
- Use `--frozen-lockfile` installs by default.
- Treat lockfile diffs as security-relevant.
- Do not let agents casually regenerate the lockfile.

## Supply-chain hardening

OAF should reduce risk from brand-new compromised package releases,
including transitive dependencies. Intended policy:

- Enable a **minimum release age** for installs where practical.
- Require an **explicit override** for newly released packages.
- **Summarize package / install changes in receipts** (issue #10).
- Use **strict / frozen installs** in CI and generated-app verification.
- **Block exotic transitive dependency sources** where practical.

## OAF Stack 0.1

The first explicit snapshot is **OAF Stack 0.1** (snapshot version
`0.1.0`).

Generated apps record which OAF stack snapshot created them, for example:

```json
{
  "oafStack": "0.1.0"
}
```

This record lets OAF reason about upgrades and reproducibility later, and lets
humans see at a glance which snapshot an app is pinned to.

### Locked Stack 0.1 snapshot

`config/stack/oaf-stack-0.1.json` is the **single authoritative source** for
every exact Stack 0.1 value: Node, pnpm, framework, data, app, and testing
pins, plus the aligned docs-pack ID. It is plain deterministic JSON, status
`locked`, and validated by `lib/stack-snapshot.ts` and offline tests.

Human-facing rationale, official-source provenance, release-age results, peer
constraints, and temporary package-resolution probe evidence live in
`docs/stack-0.1-verification.md`. That record is evidence only; it must not be
used as a second manually synchronized version authority.

The locked snapshot deliberately selects mature, stable versions rather than
newest available releases. Key calls are Node 24 Active LTS with sufficient
age, Postgres 18 with an aged exact Bookworm tag, Tailwind 4 with an exact
matched PostCSS integration pin, and TypeScript 6. TypeScript 7 remains a
future explicit stack-upgrade candidate after age and compatibility review.

## Stack snapshot governance

- **Where declared:** `config/stack/oaf-stack-0.1.json` is the authoritative
  versioned config. This document is human-readable policy; the config drives
  generation metadata.
- **How recorded in apps:** generated apps carry an `oafStack` marker
  (example above).
- **How to upgrade:** snapshot-to-snapshot upgrades go through an explicit
  `oaf update-stack` path, not casual `pnpm update`. An upgrade is a
  deliberate, receipted change.
- **Docs pack alignment:** the snapshot owns the `docsPack` ID; the matching
  docs-pack manifest records the same `oafStack` ID and tests prevent drift.

## Relationship to other issues

- **#3** defines *what* stack OAF blesses (categories and product choices).
- **#6** defines the package allowlist format and dependency-addition /
  update rules.
- **#14** (this) defines *how* OAF chooses exact versions for Stack 0.1
  and how generated apps preserve a reproducible graph.
- **#4** (folder layout), **#7** (docs pack), **#8** (app implementation)
  consume this policy.

See also:

- `docs/stack.md`
- `docs/decisions/0003-stack-snapshot-policy.md`
- `docs/decisions/0002-blessed-stack-v0.md`
