# Decision 0001: Product Shape

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Product shape (foundational)
- **Supersedes:** none
- **Superseded by:** none

## Context

OAF is starting from zero. Before any code exists, we need to lock the
product shape so that later implementation issues (#3–#11 and beyond) have
a stable foundation. The risk of not deciding now is scope creep: a coding
tool can expand forever into "understand every repo," "support every
stack," and "run everything for you."

We are explicitly choosing a narrow, opinionated shape.

## Decision

OAF is an **all-in-one, lightweight coding agent and app factory**, not a
plugin for OpenCode/Codex or another agent.

For Alpha 0:

1. **Greenfield OAF apps only.** OAF creates new apps from scratch using
   OAF's own conventions. It does not operate on arbitrary existing
   repositories.
2. **Strict conventions are a core product feature.** The factory defines
   structure; agents follow it. Conventions are documented and, where
   possible, enforced.
3. **Free-first, not necessarily local-first.** The economic promise is
   cheap-to-run apps. Local models are an optional privacy/offline/fallback
   mode, not the primary economic story.
4. **Cheap/free cloud endpoints are allowed**, but their usage must be
   budgeted and visible to the user.
5. **Agents must not invent architecture.** App structure is decided by the
   factory, not discovered at generation time.
6. **Agents must not install random packages.** Dependencies are a
   controlled, reviewed surface.
7. **Agents must not have unrestricted shell access.** The agent works
   within scoped, reviewed boundaries; destructive operations require
   explicit human consent.
8. **OAF produces receipts** for meaningful work: what changed, why, what
   it cost, and what was verified.

## Consequences

- OAF gives up breadth (many repos, many stacks, full autonomy) to gain
  legibility and low cost.
- Later issues must respect these boundaries. Anything that conflicts with
  this decision needs its own decision record that explicitly references
  and, if needed, amends 0001.
- Non-goals for Alpha 0 are tracked separately in `docs/non-goals.md`.

## Confirmed non-goals (Alpha 0)

Supporting arbitrary existing repos, supporting multiple stacks, building a
hosted SaaS, reselling LLMs or hosting, full automatic deployment,
arbitrary MCP integration, autonomous long-running coding loops, a package
marketplace, and team features are all out of scope. See
`docs/non-goals.md`.

## Follow-ups left to later issues

The following are deliberately **not** decided here and are expected to be
resolved in later issues:

- The specific stack OAF uses (issue #3–#11 range).
- The exact convention set and how conventions are enforced.
- The receipt format and what counts as "meaningful work."
- The budgeting/visibility mechanism for cloud endpoint usage.
- The precise agent boundary model (which shell/file operations are
  allowed vs. gated).
