# OAF Stack Snapshots

This document defines how OAF chooses exact dependency versions, how it
records an **OAF stack snapshot**, and how generated apps preserve a
reproducible dependency graph.

This is policy and documentation for Alpha 0. It does **not** implement
the stack or generate apps. (See issue #14; implementation lands later in
#8 / the `oaf-core` config.)

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

### Candidate version table

> **Candidate snapshot — not a final lock.**
> These pins are carried over from issue #14's research direction. Before any
> generated-app implementation treats them as final, OAF must verify current
> npm / Docker metadata, cross-package compatibility, and release age. The
> authoritative machine-readable snapshot will live in a future `oaf-core`
> config (e.g. `packages/oaf-core/src/stack/oaf-stack-0.1.ts`).

| Concern | Candidate pin | Notes |
| --- | --- | --- |
| Node | `24.18.0` | Node 24 LTS for the longest practical support runway. |
| pnpm | `11.5.2` | Pin package manager. Verify Node 24 compatibility and supply-chain hardening defaults. |
| Next.js | `16.2.7` | Current stable major; avoid release-day latest. Verify React 19 / Node 24 compatibility. |
| React | `19.2.7` | Keep React and React DOM matched exactly. |
| React DOM | `19.2.7` | Must match React exactly. |
| TypeScript | `6.0.3` | Initial Stack 0.1 candidate. Track TypeScript 7 as likely early upgrade target once mature. |
| Postgres image | `postgres:18.4-bookworm` | Current supported Postgres major, exact minor image tag, Debian base. |
| Drizzle ORM | `0.45.2` | Candidate ORM / schema layer pin. |
| Drizzle Kit | `0.31.10` | Candidate migration / tooling pin; verify with Drizzle ORM version. |
| Better Auth | `1.6.14` | Candidate auth pin; verify Next 16 / React 19 / Drizzle compatibility. |
| Zod | `4.4.3` | Candidate validation / schema-boundary pin. |
| Tailwind CSS | `4.x` (exact TBD) | Use Tailwind 4, not v3. Resolve exact pin after npm compatibility / release-age check. **Must not be left as `4.x` in generated-app implementation.** |
| `@tailwindcss/postcss` | matching `4.x` (exact TBD) | Likely needed for Next / PostCSS setup in Tailwind 4. Match Tailwind CSS version per Tailwind Labs guidance. |
| `@tailwindcss/vite` | likely not needed for Next | Include only if the generated app / tooling actually uses Vite; do not add casually. |
| Vitest | `4.1.8` | Candidate unit / integration test pin. |
| Playwright | `1.60.0` | Candidate browser / e2e / visual smoke test pin. Avoid release-day browser bundle churn. |
| pg | `8.21.0` | Candidate Postgres client pin if needed by the stack. |

### Tailwind 4 decision

OAF uses **Tailwind CSS 4** as the Stack 0.1 styling baseline unless
compatibility research finds a blocker. Rationale: v4 is the better
long-term foundation — faster, lighter, modern, and aligned with OAF's goal
of cheap, repeated agent loops (released January 2025; ground-up rewrite
with a new high-performance engine, simplified install, automatic content
detection, CSS-first config).

If Tailwind ships a formal v4 LTS / dist-tag, prefer it. If not, choose a
mature stable v4 release that satisfies the release-age policy and works
cleanly with Next.js. The exact pin must be resolved before generated-app
implementation; it must not silently remain `4.x`.

### TypeScript 7 tracking decision

OAF Stack 0.1 starts on **TypeScript 6** unless TypeScript 7 has aged
enough and passes compatibility checks by implementation time. TypeScript 7
remains an explicit **early stack-upgrade target**, because native compiler /
tooling speed improvements matter for OAF's fast feedback loops.

## Stack snapshot governance

- **Where declared:** the authoritative snapshot will be a versioned config
  in `oaf-core` (future). This document is the human-readable policy; the
  config is the source of truth for generation.
- **How recorded in apps:** generated apps carry an `oafStack` marker
  (example above).
- **How to upgrade:** snapshot-to-snapshot upgrades go through an explicit
  `oaf update-stack` path, not casual `pnpm update`. An upgrade is a
  deliberate, receipted change.
- **Docs pack alignment:** how docs pack versions align with pinned
  dependency versions is deferred to issue #7.

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
