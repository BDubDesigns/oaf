# OAF Doctrine

This document states the beliefs OAF is built on. They are not negotiable
within the scope of the project's early life. When a future change
conflicts with this doctrine, the doctrine wins unless a decision record
explicitly overturns it.

## 1. OAF creates codebases agents can understand

OAF does not try to understand every codebase. That problem is effectively
unbounded: every repo has its own history, conventions, footguns, and
implicit knowledge.

Instead, OAF *produces* codebases with a small, strict surface area. The
agent that builds an OAF app and the agent that maintains it later are
working in a shape they can rely on. Predictability is the product.

## 2. OAF is an all-in-one app factory, not a plugin

OAF is a standalone, lightweight coding agent and app factory. It is not
an OpenCode/Codex plugin, and it is not a thin layer over someone else's
agent loop. The factory owns the conventions, the boundaries, and the
guardrails end to end.

This keeps the product coherent: the same system that defines the rules
also enforces them.

## 3. Strict conventions are a feature, not a burden

Conventions in OAF are not style preferences. They are the mechanism that
makes apps legible to agents. OAF uses strict, enforced conventions as a
core product feature.

Where a convention exists, it is documented and, where possible, checked.
Where a choice is left open, that is a documented gap — not freedom to
drift.

## 4. Free-first, not necessarily local-first

OAF is free-first. The economic promise is that building and running OAF
apps stays cheap. It is not required to run everything locally.

Local models are supported as an optional mode: privacy, offline use, and
fallback when cloud is unavailable. They are not the primary economic
story. Cloud endpoints that are cheap or free are allowed and encouraged —
but their usage must be budgeted and visible (see receipts, below).

## 5. Agents do not invent architecture

OAF must not let agents invent architecture. The structure of an OAF app
is decided by the factory, not discovered by the model at generation time.
When a task would require new architecture, that is a product decision, not
an agent decision.

## 6. Agents do not install random packages

OAF must not let agents install random packages. Dependencies are a
controlled surface. Adding a dependency is a deliberate act with visible
cost and review, not something a model does unprompted to unblock itself.

## 7. Agents do not get unrestricted shell access

OAF must not give agents unrestricted shell access. The agent operates
within scoped, reviewed boundaries. Destructive or wide-reaching operations
require explicit human consent. The factory defines what is allowed; the
agent does not expand that set on its own.

## 8. OAF produces receipts

For meaningful work, OAF produces a receipt: what changed, why, what it
cost, and what was verified. Receipts make agent work auditable and keep
humans in the loop without micromanaging.

## Summary

OAF trades flexibility for legibility. It gives up "understand any repo"
to gain "never be surprised by this repo." Everything else follows from
that trade.
