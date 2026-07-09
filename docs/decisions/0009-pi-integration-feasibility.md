# Decision 0009: Pi Integration Feasibility

- **Status:** Accepted
- **Date:** 2026-07-09
- **Decision type:** Agent-loop architecture (Alpha 1 planning)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/doctrine.md` (§2, §7), `docs/non-goals.md`,
  `docs/sandbox.md`, `docs/receipts.md`, `docs/spikes/pi-integration.md`,
  decision 0001 (product shape), issue #11

## Context

Issue #11 asks whether OAF should **wrap Pi**, **fork Pi**, or **build a tiny
custom agent loop** for the next milestone. Pi is `earendil-works/pi` (MIT), a
mature self-extensible coding-agent harness: `pi-ai` (unified multi-provider
LLM API), `pi-agent-core` (agent runtime + agent loop), `pi-coding-agent`
(interactive CLI), `pi-tui`, and `pi-orchestrator`.

We inspected Pi's source to judge fit against OAF's doctrine. Key findings:

- Pi's agent loop is generic and tool-driven, with hooks `beforeToolCall`
  (can **block** a call), `afterToolCall` (can rewrite results),
  `transformContext`, `convertToLlm`, and an `EventStream<AgentEvent>` that
  emits `tool_execution_start/end`, `message_start/end`, and `agent_end`.
- Pi's native `bash` tool `spawn`s the launching user's shell with **full
  permissions**. The README states Pi "does not include a built-in permission
  system" and delegates containerization/isolation to the host (Gondolin, plain
  Docker, OpenShell).
- The `bash` tool is pluggable via a `BashOperations` interface
  (`exec(command, cwd, options)`), so a custom exec backend can be supplied.

The decisive tension: **doctrine §2 and decision 0001 state OAF is not "a thin
layer over someone else's agent loop" and that "the factory owns the
conventions, the boundaries, and the guardrails end to end."** Pi's core model
is the inverse — Pi owns the loop; the host owns isolation.

## Decision

For Alpha 1, OAF will **build a tiny custom OAF-owned agent loop**. It will
**not** wrap Pi and will **not** fork Pi as a runtime dependency.

OAF will adopt Pi's *design patterns* as reference (not as code):

1. An `EventStream<AgentEvent>`-style event model with tool-execution and
   agent-end events → feeds OAF receipts (`docs/receipts.md`).
2. `beforeToolCall` / `afterToolCall` gating hooks → the shape of OAF's
   sandbox pre-check and receipt post-step.
3. A pluggable exec backend → the seam where OAF's `oaf sandbox run`
   (`docs/sandbox.md`) belongs, by construction rather than by override.
4. An extension / lifecycle-subscription model → how OAF attaches docs-pack
   context (`docs/docs-pack.md`) and receipt emitters without entangling the
   loop.
5. Supply-chain hardening (pinned direct deps, lockfile-as-ground-truth,
   reviewed dependency changes) → already OAF policy; keep it.

Rationale:

- **Doctrine alignment.** A custom loop is the only option consistent with
  decision 0001's "not a thin layer over someone else's agent loop."
- **Ownership of boundaries.** Wrapping Pi makes OAF's sandbox a best-effort
  wrapper around Pi's default unrestricted `bash`; forking Pi inherits Pi's
  loop and a large maintenance surface. A small OAF loop keeps the sandbox and
  receipts first-class.
- **Dependency control.** Pi pulls a large tree (multi-provider AI, TUI,
  orchestrator). Adding it conflicts with OAF's controlled-dependency stance
  (`docs/package-policy.md`).
- **License is not the blocker.** Pi is MIT and OAF is AGPLv3; wrapping or
  forking is legally permissible. The reason to avoid Pi is architectural and
  doctrinal, not licensing.

## Consequences

- OAF owns its agent loop, tool set, sandbox boundary, and receipt emission end
  to end.
- Alpha 1 agent work re-implements a narrow loop (streaming, tool-calling
  orchestration, truncation handling, context compaction) sized to OAF's
  greenfield, single-stack, fixed-tool needs.
- OAF deliberately does **not** take on Pi's dependency surface or its
  "host owns isolation" assumption.
- The spike (`docs/spikes/pi-integration.md`) is the supporting research record.

## Confirmed non-goals / deferred

- Adding Pi (or any agent harness) as a dependency in Alpha 0/1.
- Wrapping or forking Pi.
- Provider integration beyond a single pinned SDK for the Alpha 1 prototype.
- Modifying the sandbox runner (#9) for this decision; the loop consumes it
  as-is.
- Autonomous long-running loops (see `docs/non-goals.md`).

## Follow-ups

- Define the minimal OAF agent loop + `AgentEvent` model (Alpha 1).
- Register a fixed OAF tool set whose `execute` routes through `oaf sandbox
  run`; no tool gets raw shell.
- Wire loop completion / `afterToolCall` into receipt emission (#10).
- Inject the OAF local docs pack (#7) + `AGENTS.md` as loop context.
- Keep the loop greenfield-only and internet-off by default per
  `docs/sandbox.md`.
