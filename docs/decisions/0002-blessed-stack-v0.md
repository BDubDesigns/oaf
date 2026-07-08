# Decision 0002: Blessed Stack v0

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Stack definition (Alpha 0)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/stack.md`, `docs/decisions/0001-product-shape.md`

## Context

Issue #3 asks OAF to define its first blessed app stack. Per decision
0001, OAF supports **one** blessed stack at first and is explicitly
**not** a stack chooser or multi-stack factory. The point of choosing one
stack is not popularity coverage — it is predictability. A single, common,
agent-legible stack lets cheap/free/local models operate with less context
and fewer bad guesses.

We must decide the concrete v0 stack now so that later issues — dependency
policy (#6), app structure (#4), docs pack (#7), `oaf init` (#8), and the
sandbox runner (#9) — all build around the same surface.

## Decision

For Alpha 0, OAF blesses the following single stack:

1. **OAF blesses one stack for Alpha 0.** It is not a generic stack
   chooser. All generated apps use this stack.
2. **pnpm is the default package manager.**
3. **Postgres is the default database from day one.** No multi-dialect
   abstraction in v0.
4. **Drizzle is the database / schema layer.**
5. **Better Auth is the blessed auth path.** OAF may scaffold auth by
   default or define it as a blessed module in a later issue; v0 does not
   require every generated app to ship fully configured production auth.
6. **Zod is the validation / default schema boundary.**
7. **Tailwind CSS is the styling baseline.**
8. **Vitest and Playwright are the testing baseline** (unit/integration
   and browser/e2e/visual smoke respectively).
9. **Generated apps should be Docker / Coolify-ready**, but Alpha 0 does
   **not** include automatic deployment.
10. **OAF uses pinned stack snapshots instead of unpinned `latest`
    installs.** No `@latest`, pinned package-manager and Node versions,
    pinned direct dependencies, committed lockfile, pinned Postgres image,
    and an explicit future stack-upgrade path.

The concrete list (framework, language, ORM, etc.) lives in
`docs/stack.md`.

## Version policy

- No `@latest` in generated apps.
- Package manager version pinned.
- Direct dependencies pinned.
- Lockfile committed.
- Node version specified.
- Postgres image version pinned.
- Future stack updates go through an explicit OAF stack upgrade path.

Exact version numbers are intentionally deferred to the dependency /
package policy issue (#6) unless a concrete example is required here.

## Consequences

- The agent, docs pack, package policy, sandbox, and generated-app
  structure issues can all assume this stack.
- Cheap/free/local models get a smaller, more predictable surface to
  reason about.
- Non-goals from decision 0001 hold: no multi-stack support, no automatic
  deployment, no arbitrary package installation.

## Confirmed deferred to later issues

- Exact dependency versions → #6 (package allowlist / dependency policy).
- Exact canonical folder structure → #4.
- Exact Better Auth scaffolding details → a later design/implementation
  issue.
- Exact package allowlist format → #6.
- Exact docs pack format → #7.
- Exact generated app implementation → #8.
- Exact sandbox implementation → #9.
- Exact deployment automation → out of Alpha 0 scope (see
  `docs/non-goals.md`).
