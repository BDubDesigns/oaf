# Spike: Pi Integration Feasibility

- **Issue:** #11 — Spike Pi integration feasibility
- **Date:** 2026-07-09
- **Author:** OAF agent (spiked)
- **Status:** Decision reached — build a tiny custom OAF loop; do **not** wrap or fork Pi for Alpha 1.
- **Related:** `docs/decisions/0009-pi-integration-feasibility.md`

## TL;DR

Pi (`earendil-works/pi`, MIT) is a mature, well-architected coding-agent
harness. It *could* be wrapped or forked into OAF with sandbox-routed tools.
But doing so would make OAF a thin layer over someone else's agent loop,
which directly contradicts doctrine §2 and decision 0001 ("OAF is not a thin
layer over someone else's agent loop; the factory owns the conventions, the
boundaries, and the guardrails end to end").

**Recommendation: build a tiny custom OAF loop for Alpha 1**, reusing Pi's
*design patterns* as reference (event-stream hooks, before/after tool-call
gating, pluggable exec, extension model, supply-chain hardening) — but **not**
as a runtime dependency. This keeps OAF honest, convention-locked, and
dependency-light, and keeps the sandbox and receipts first-class rather than
wrappers.

## 1. What is Pi?

Pi is a full self-extensible coding-agent harness (MIT, by Mario Zechner /
`earendil-works`). Packages:

- `@earendil-works/pi-ai` — unified multi-provider LLM API (OpenAI, Anthropic,
  Google, …).
- `@earendil-works/pi-agent-core` — agent runtime: tool calling, state
  management, and the **agent loop**.
- `@earendil-works/pi-coding-agent` — interactive coding-agent CLI.
- `@earendil-works/pi-tui` — terminal UI.
- `@earendil-works/pi-orchestrator` — multi-agent workflows.

**Problem it solves:** a ready-made, multi-provider coding agent you can run
interactively or as a library, extend with TypeScript "extensions," and route
into a container for isolation.

**Assumptions it makes (inspected from source):**

- **Repo structure:** none imposed. Pi edits whatever repo you point it at.
  It is generic, not opinionated about app layout.
- **Tools:** native tool set includes `bash`, `read`, `write`, `edit`,
  `edit-diff`, `find`, `grep`, `ls`. The `bash` tool by default `spawn`s the
  user's shell with full permissions.
- **Prompts:** system prompt is buildable/extensible; skills and context
  transforms exist.
- **Execution:** **no built-in permission system.** The README states Pi
  "does not include a built-in permission system for restricting filesystem,
  process, network, or credential access. By default, it runs with the
  permissions of the user and process that launched it." Containerization is
  explicitly delegated to the host (Gondolin micro-VM, plain Docker, OpenShell).
- **Agent-loop ownership:** Pi owns the loop. It exposes hooks
  (`beforeToolCall` can **block** a call; `afterToolCall` can rewrite results;
  `transformContext`, `convertToLlm`, `prepareNextTurn`, `shouldStopAfterTurn`)
  and an `EventStream<AgentEvent>` (emits `tool_execution_start/end`,
  `message_start/end`, `agent_end`, …). The `bash` tool is pluggable via a
  `BashOperations` interface (`exec(command, cwd, options)`) — an extension can
  supply a custom exec backend.

## 2. How well does Pi match OAF?

| OAF doctrine / need | Pi fit | Notes |
| --- | --- | --- |
| OAF owns app structure | Compatible | Pi imposes none; OAF keeps ownership. |
| OAF owns the command boundary (sandbox) | **Conflict** | Pi's default `bash` = unrestricted. Mitigable via `BashOperations` override + `beforeToolCall` gate, but that is a wrapper, not ownership. |
| Greenfield-first (Alpha 0) | Compatible | Pi is repo-agnostic. |
| Local docs packs | Compatible | Feedable via system prompt / context transform / skills. |
| Receipts required | Feasible | `afterToolCall` + event stream can drive receipt emission. |
| No unrestricted shell | **Conflict** | Pi's whole model is "runs as the launching user." Sandboxing is the host's job, per Pi docs. |
| Not a generic agent harness | **Conflict** | Doctrine §2 / decision 0001: OAF is *not* "a thin layer over someone else's agent loop." Wrapping Pi is exactly that. |
| Minimal, controlled dependencies | **Conflict** | Pi pulls a large tree (multi-provider AI, TUI, orchestrator). Wrapping or forking inherits it, against OAF's controlled-surface stance. |

**Summary:** Pi is technically integrable and architecturally clean, but its
core assumption — *Pi owns the loop; the host owns isolation* — sits opposite
OAF's core assumption — *OAF owns the loop and the boundaries end to end*.

## 3. Options evaluated

### 3.1 Wrap Pi as an internal engine

- **Benefits:** fastest path to capability. Mature tool calling, streaming,
  multi-provider LLM API, event stream, extension model. Sandbox-routable via a
  custom `BashOperations` + `beforeToolCall` gate; receipts via `afterToolCall`
  / events.
- **Risks:** **violates doctrine §2 / decision 0001** (thin layer over Pi's
  loop). Adds a large dependency surface. OAF's guardrails become best-effort
  wrappers — if Pi changes bash/tool semantics, OAF's protections can be
  silently bypassed. The default `bash` tool gives unrestricted shell; OAF must
  remember to override it on every configuration path.
- **What changes:** add Pi dependency; write an OAF wrapper that owns tool
  registration, routes `BashOperations`/`execute` through `oaf sandbox run`,
  gates via `beforeToolCall`, emits receipts via `afterToolCall`.
- **Sandbox interaction:** route tool `execute` through `oaf sandbox run`; must
  **not** register Pi's native `bash` tool.
- **Receipts interaction:** subscribe to the event stream / `afterToolCall`.
- **Honest / convention-locked?** No — it is a thin layer over Pi's loop.

### 3.2 Fork Pi and constrain it

- **Benefits:** own the source; can delete the native unrestricted `bash` tool,
  hard-wire the OAF sandbox, and embed receipt emission inside the loop.
- **Risks:** inherits Pi's architecture and dependency tree; the loop
  (streaming, orchestration) is still Pi's design — arguably still "someone
  else's loop" even when forked. Ongoing rebase/maintenance cost against an
  actively developed upstream. AGPL-forking MIT is legally fine, but you then
  own a large codebase and its drift.
- **What changes:** fork; strip/relocate the tool layer; embed OAF sandbox +
  receipts into the forked loop.
- **Sandbox interaction:** native inside the fork.
- **Receipts interaction:** native inside the fork.
- **Honest / convention-locked?** Weakly — you own a fork, but the loop design
  is inherited and the maintenance burden is high. Only weakly satisfies the
  "factory owns the loop end to end" intent.

### 3.3 Build a tiny custom OAF loop

- **Benefits:** aligns with doctrine §2 / decision 0001 — OAF owns the loop,
  boundaries, and guardrails end to end. Minimal dependencies (a provider SDK +
  OAF's own sandbox). Sandbox and receipts are first-class, not wrappers. Full
  control over app-structure awareness, docs-pack context injection, and
  internet-off modes.
- **Risks:** more upfront work; must re-implement tool-calling orchestration,
  streaming, truncation handling, and context compaction. But OAF's needs are
  narrow (greenfield, one stack, a small, fixed tool set).
- **What changes:** implement an `oaf agent` loop in the OAF repo (extends the
  #8 / #9 surface); reuse the sandbox runner (#9) for execution and receipts
  (#10) for audit.
- **Sandbox interaction:** native — the loop calls `oaf sandbox run`.
- **Receipts interaction:** native — the loop emits receipts.
- **Honest / convention-locked?** Yes — consistent with decision 0001.

### 3.4 Defer the decision

- **Benefits:** avoids premature commitment; gathers hands-on cost/model data
  first.
- **Risks:** blocks Alpha 1 planning; but the doctrine conflict is already
  clear on the evidence available, so deferral buys little here.
- **Verdict:** not needed. The doctrine/architecture mismatch is decidable now.

## 4. Recommendation

**Recommended for Alpha 1: build a tiny custom OAF loop first.**

Do **not** wrap Pi and do **not** fork Pi for Alpha 1. Instead, adopt Pi's
*ideas* as design reference — they are good and worth stealing:

- an `EventStream<AgentEvent>`-style event model with `tool_execution_start/
  end` and `agent_end` events → maps cleanly onto OAF receipts;
- `beforeToolCall` / `afterToolCall` gating hooks → the shape OAF's sandbox
  pre-check and receipt post-step should take;
- a pluggable exec backend (`BashOperations`-style) → the seam where OAF's
  `oaf sandbox run` belongs, by construction, not by override;
- an extension/lifecycle-subscription model → how OAF can attach docs-pack
  context and receipt emitters without entangling the loop;
- supply-chain hardening (pinned direct deps, lockfile-as-ground-truth,
  reviewed dependency changes) → already part of OAF's package policy; keep it.

**Why not wrap/fork despite Pi's quality:** the conflict is not technical, it
is doctrinal. Doctrine §2 and decision 0001 are explicit that OAF must own the
loop end to end and must not be a thin layer over another harness. Wrapping
Pi inverts that; forking Pi keeps the inherited loop and adds a large
maintenance surface. A small OAF-owned loop is the only option that keeps OAF
honest and convention-locked while remaining dependency-light.

**License note:** Pi is MIT and OAF is AGPLv3. Wrapping or forking is
*legally* permissible (MIT is compatible with AGPL usage). So licensing is not
the reason to avoid Pi — the reason is architecture and doctrine.

### What should happen next (Alpha 1)

1. Define a minimal OAF agent loop that calls a provider SDK and emits
   `AgentEvent`s into the receipt pipeline.
2. Register a small, fixed OAF tool set (`read`, `edit`, `write`, `bash`,
   `find`, `grep`, `ls`) whose `execute` routes through `oaf sandbox run`
   (#9). No tool gets raw shell.
3. Wire `afterToolCall` / loop completion into receipt emission (#10).
4. Inject the OAF local docs pack (#7) + `AGENTS.md` as the loop's context.
5. Keep the loop greenfield-only and internet-off by default, matching
   `docs/sandbox.md` modes.

### What should explicitly NOT happen yet

- Do **not** add Pi (or any agent-harness) as a dependency in Alpha 0/1.
- Do **not** implement provider integration beyond a single pinned SDK for the
  spike prototype.
- Do **not** start the receipt *emitter* persistence work beyond what #10
  already specifies.
- Do **not** modify the sandbox runner (#9) for this spike; the loop will
  consume it as-is. (No documentation cross-link change was required.)
- Do **not** pursue autonomous long-running loops (non-goal).

## Research performed

- Read OAF docs: `README.md`, `AGENTS.md`, `docs/doctrine.md`,
  `docs/non-goals.md`, `docs/app-structure.md`, `docs/sandbox.md`,
  `docs/receipts.md`, `docs/docs-pack.md`, `docs/package-policy.md`,
  `docs/stack.md`, and ADRs `0001`, `0002`, `0005`, `0008`.
- Located Pi at `earendil-works/pi` (no `pi` repo exists under `BDubDesigns`).
- Inspected Pi source: `packages/agent/src/agent-loop.ts` (loop, `beforeToolCall`
  block hook, `afterToolCall`, event stream), `packages/coding-agent/src/core/
  tools/bash.ts` (`BashOperations` pluggable exec), and the extension/hook model
  in `packages/coding-agent/src/core/extensions/`.
- Confirmed Pi's README stance: no built-in permission system; containerization
  delegated to the host.

## Decision

See `docs/decisions/0009-pi-integration-feasibility.md`. Spike recommends
**build a tiny custom OAF loop for Alpha 1; do not wrap or fork Pi.**
