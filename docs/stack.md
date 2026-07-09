# OAF Blessed Stack v0

This document defines the **one** web app stack OAF blesses for Alpha 0.

OAF is an Opinionated App Factory, not a stack chooser. The goal is not to
support every popular framework. The goal is to make one stack predictable
enough that cheap, free, and local models can operate inside it with less
context and fewer bad guesses.

Design principle for every choice below:

> Boring, common, agent-legible.
> The stack should be easy for a coding agent to understand without
> extended exploration.

## The v0 stack

| Concern            | Choice            |
| ------------------ | ----------------- |
| Framework          | Next.js           |
| Language           | TypeScript        |
| Package manager    | pnpm              |
| Database           | Postgres          |
| Schema / query     | Drizzle           |
| Auth               | Better Auth       |
| Validation         | Zod               |
| Styling           | Tailwind CSS      |
| Unit / integration | Vitest            |
| Browser / e2e     | Playwright        |
| Deployment target  | Docker / Coolify-ready |
| Local database     | Docker / Podman Postgres container |

## Why these choices

- **Next.js + TypeScript.** A mainstream, well-documented full-stack
  framework. Agents see this shape constantly; the training-distribution
  overlap is high, which reduces guesswork.
- **pnpm.** Fast, disk-efficient, and a strict, deterministic install model
  that fits OAF's control-over-dependencies stance.
- **Postgres.** A single, capable, boring relational database from day one.
  No multi-dialect abstraction layer in v0.
- **Drizzle.** A typed, SQL-close ORM/query builder that keeps the schema
  and queries legible in code. Favored over heavier, more magical layers.
- **Better Auth.** The blessed auth path. OAF may scaffold auth by default
  or define it as a blessed module in a later issue; see "Deferred" below.
- **Zod.** The validation and default schema boundary. Used for runtime
  validation and shared types where it reduces duplication.
- **Tailwind CSS.** A utility styling baseline that avoids bespoke
  component-library lock-in while keeping markup self-describing.
- **Vitest + Playwright.** A single unit/integration baseline plus a
  browser/e2e/visual smoke baseline. Both are common and agent-familiar.

## Deployment readiness

Generated apps should be **Docker / Coolify-ready**: a container image
definition and configuration that can be deployed to a Coolify-managed host
or any Docker host.

Alpha 0 does **not** include automatic deployment. OAF may prepare an app
to run, but it does not own your production deployment pipeline. (See
`docs/non-goals.md`.)

## Version policy

OAF uses **pinned stack snapshots** instead of unpinned `latest` installs.
This is a deliberate product decision: predictable apps are cheaper and
safer to operate and maintain.

For every generated app:

- No `@latest` in dependencies.
- The package manager version is pinned.
- Direct dependencies are pinned.
- The lockfile is committed.
- The Node version is specified (e.g. via `engines` / a version file).
- The Postgres image version is pinned.
- Future stack changes happen through an explicit OAF stack upgrade path,
  not ad-hoc drift.

Exact versions and the OAF Stack 0.1 snapshot policy are intentionally
left to issue #14. The package allowlist format and
dependency-addition/update policy remain scoped to #6 unless a specific
example is needed here.

## What this document does NOT do

This document defines the stack. It does **not** implement it, pin exact
versions, or dictate folder layout. Exact stack snapshot versions and the
version-pinning policy are scoped to #14; the package allowlist and
dependency-addition policy are scoped to #6. Folder layout is scoped to #4.

See also:

- `docs/stack-snapshots.md` — exact version selection and OAF Stack 0.1 snapshot policy.
- `docs/doctrine.md`
- `docs/non-goals.md`
- `docs/decisions/0002-blessed-stack-v0.md`
