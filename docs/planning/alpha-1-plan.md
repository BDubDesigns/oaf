# Alpha 1 Plan: Tiny OAF-Owned Agent Loop

- **Date:** 2026-07-09
- **Author:** OAF agent (review/planning pass)
- **Status:** Proposed — for review, not yet scheduled
- **Related:** issue #11 (Pi spike, ADR 0009), `docs/spikes/pi-integration.md`,
  decisions 0001 (product shape), 0005 (sandbox policy), 0008 (receipts),
  0009 (Pi feasibility)
- **Scope:** Alpha 1 = the smallest useful OAF-owned agent loop. No Pi
  dependency. Reuses the existing sandbox runner (#9) and receipt format
  (#10).

## 1. What Alpha 0 now proves

After the doctrine, `oaf init`, receipt, sandbox, and Pi-spike work, OAF has a
**concrete, working factory + safety loop** — minus the agent:

- **Defined product surface (docs + ADRs 0001–0009).** One blessed stack, one
  canonical app structure, sandbox command policy, receipt format, local
  docs-pack design, package policy, and the Pi-integration decision are all
  locked.
- **`oaf init` works (real).** Scaffolds a canonical app skeleton:
  `app/`, `db/`, `oaf/` (app.json, stack.json, docs-pack.json),
  `README.md`, `package.json`, `oaf/doctor.mjs`, `tests/sanity.test.mjs`.
  Refuses existing/non-empty dirs and path-traversal names.
- **`oaf doctor` works (real).** Structural validation of a generated app.
- **`oaf sandbox run` works (real).** Enforces the allowlist, confirmation,
  and network policy; runs inside a locked-down container (rootless-friendly,
  no-new-privileges, project dir only, Docker socket off). `oaf sandbox
  status` reports runtime availability.
- **Tests pass.** `tests/oaf-init.test.mjs` and `tests/sandbox.test.mjs` are
  green.

**Concrete loop Alpha 0 nearly supports:** human defines an app → `oaf init`
creates a convention-locked skeleton → `oaf doctor` verifies it → commands run
only through the policy-enforced sandbox. What is missing is the **agent** that
proposes those commands and records what happened.

## 2. What is still fake, placeholder, or incomplete (honest)

- **The generated app is a skeleton, not an app.** `package.json` has no real
  dependencies; `db/client.ts`, `app/layout.tsx`, etc. are stubs. `doctor`
  checks structure only, not runnability.
- **No agent loop exists.** No model calls, no tools, no `AgentEvent` model,
  no loop orchestration. This is the entire Alpha 1 payload.
- **Receipts are format-only.** `docs/receipts.md` defines the schema; there
  is **no emitter, no storage, no wiring** to the sandbox command log.
- **Docs pack has no content.** `docs-pack.md` is a design; the
  `docs-packs/stack-0.1/` tree and `manifest.json` do not exist yet. The
  `oaf/docs-pack.json` marker is written but points at nothing real.
- **Sandbox ↔ receipts ↔ agent are not connected.** The sandbox logs
  executions (per #5/#9) but nothing aggregates them into a receipt.
- **No provider integration.** Not even a single pinned SDK seam exists.
- **No tests for an agent run.** Only `init` and `sandbox` smoke tests exist.

## 3. What Alpha 1 should prove (smallest useful)

A tiny OAF-owned loop that closes the missing step above:

1. **OAF-owned agent loop** — OAF controls orchestration end to end (per ADR
   0009, no Pi). One prompt in, one task out.
2. **Fixed Alpha 1 tool set** — a small, known set (`read`, `list`, `grep`,
   `write`/`edit`, and one `bash`/command tool). No tool discovery, no
   arbitrary tools.
3. **Sandbox-routed command execution** — the command tool's `execute` calls
   `oaf sandbox run`. The agent never gets a raw shell.
4. **Local docs-pack context** — the loop loads local markdown context from a
   generated app's `oaf/docs-pack.json` marker (even if the pack is a minimal
   hand-authored stub) and injects it as loop context.
5. **Receipt emission** — at loop end, emit one JSON receipt
   (`docs/receipts.md` schema) capturing the prompt, plan, files touched,
   commands run (mirroring sandbox logs), checks, and outcome.
6. **Generated-app awareness** — the loop operates on an `oaf init`-generated
   app and is greenfield-only; it reads `oaf/*.json` metadata to know it is in
   an OAF app.

**Success = one end-to-end run:** `oaf agent "add a hello route"` on a
generated app → loop reads docs-pack context → proposes edits/commands →
sandbox executes them → a JSON receipt is written to `oaf/receipts/`.

## 4. What stays explicitly out of scope (reaffirm non-goals)

- No support for **arbitrary existing repositories** (greenfield OAF apps only).
- No **multi-stack** support (one blessed stack).
- No **hosted SaaS** / no **provider resale or billing**.
- No **autonomous long-running loops** (human-in-the-loop; receipts).
- No **arbitrary package installs** (allowlist + pinned; policy approval).
- No **unrestricted shell** (every command via `oaf sandbox run`).
- No **Coolify / production deployment automation**.
- No **Pi dependency**, no wrapping/forking Pi (ADR 0009).
- No pretty receipt viewer (#21), no receipt storage backend, no analytics.

## 5. Proposed next issues (Alpha 1) — drafts, not yet created

Each is scoped to one focused PR. Titles and acceptance criteria below are
issue-ready. Numbers are suggested and can be renumbered at creation time.

### Issue A1-1 — Define minimal `AgentEvent` model
- **Scope:** A TypeScript/JSON-typed event model for the OAF loop:
  `agent_start`, `turn_start`, `message_start/end`, `tool_call`,
  `tool_execution_start/end`, `tool_result`, `receipt_emitted`, `agent_end`.
  Single source file, no runtime deps.
- **Acceptance:** file `lib/agent/events.mjs` (or `.ts`) exports the event
  types + a tiny in-memory collector; unit test asserts shape. No loop yet.
- **Non-goals:** no provider SDK, no tools, no receipt writer.

### Issue A1-2 — Define fixed Alpha 1 tool set
- **Scope:** Enumerate the exact tool set and each tool's JSON schema/args:
  `read`, `list`, `grep`, `write`/`edit`, `bash` (command). Document the
  contract (name, args, executionMode, who executes it).
- **Acceptance:** `docs/agent-tools.md` + a `lib/agent/tools.mjs` registry
  stub (tool definitions, no execution bodies required yet). Decision on
  `write` vs `edit` granularity recorded.
- **Non-goals:** implementing tool bodies, sandbox wiring.

### Issue A1-3 — Implement minimal read/list/grep tools
- **Scope:** Safe, filesystem-bounded read-only tools that operate only inside
  the project workspace (mirror sandbox mount rules). `read` (path, optional
  range), `list` (dir), `grep` (pattern, path).
- **Acceptance:** tools live in `lib/agent/tools/`; unit tests on a temp
  fixture; each rejects paths outside the workspace. No network.
- **Non-goals:** write/edit/bash (later issues), sandbox container (these run
  in-process, read-only, workspace-bounded).

### Issue A1-4 — Implement sandbox-routed command tool
- **Scope:** The `bash`/command tool whose `execute` calls `oaf sandbox run`
  (reuse `lib/sandbox.mjs`). Passes through `--network`/`--confirm` only when
  policy allows. Returns exit code + captured output.
- **Acceptance:** `lib/agent/tools/bash.mjs` invokes the sandbox; tests assert
  allowed commands run, confirmation/network-gated commands fail closed, and
  nothing escapes the workspace. Reuses existing sandbox tests' patterns.
- **Non-goals:** new sandbox policy; changing `lib/sandbox.mjs` behavior.

### Issue A1-5 — Implement minimal model-call loop with one provider seam
- **Scope:** A loop that (1) builds context from a prompt + docs-pack +
  AgentEvents, (2) calls a model via a single provider seam
  (`lib/agent/provider.mjs` — interface + one stub/mock implementation so no
  real key is needed for tests), (3) parses tool calls, (4) executes them,
  (5) repeats until stop.
- **Acceptance:** `lib/agent/loop.mjs` runs end-to-end against the mock
  provider; emits `AgentEvent`s; stops on a terminal condition. No real API
  calls required for tests.
- **Non-goals:** real provider SDK (Alpha 1 uses a mock seam; real provider is
  a later issue), multi-turn sophistication, compaction.

### Issue A1-6 — Emit first JSON receipt from an agent run
- **Scope:** At loop end, aggregate `AgentEvent`s + sandbox command logs into
  one JSON receipt per `docs/receipts.md`, written to
  `oaf/receipts/<timestamp>-<short-id>.json`.
- **Acceptance:** a scripted agent run (mock provider) produces a valid
  receipt JSON; schema fields (status, commands, files, usage stub) present;
  secret redaction policy respected (no values recorded).
- **Non-goals:** receipt viewer, storage backend, human-review workflow.

### Issue A1-7 — Add sample generated-app fixture for agent-loop tests
- **Status:** Implemented by #33 as `tests/fixtures/generated-app/`.
- **Scope:** A committed, curated subset of real `oaf init` output with
  `oaf/*.json` markers, a copy helper, and deterministic offline doctor/sanity
  validation. Drift checks compare retained generated files to the current
  templates.
- **Acceptance:** future agent-loop tests can copy the fixture into an
  independent temporary workspace; no network used.
- **Non-goals:** docs-context loading or docs-pack content, real Next.js app.

### Issue A1-8 — Alpha 1 status / README updates
- **Scope:** Update `README.md` Status + add an `oaf agent` usage line once
  the loop lands; add a short `docs/status.md` or section noting Alpha 1
  capabilities and what remains stubbed.
- **Acceptance:** README Status is accurate (no "no sandbox runner" style
  stale claims); documents the Alpha 1 loop shape.
- **Non-goals:** rewriting doctrine/non-goals; new ADRs unless a real decision
  is forced.

## 6. Suggested sequencing

A1-1 → A1-2 (model + tool contracts) → A1-3 / A1-4 (tools) → A1-5 (loop +
mock provider) → A1-7 (fixture) → A1-6 (receipt) → A1-8 (docs). A1-7 can
land alongside A1-5.

## 7. Intentionally deferred (do not expand into Alpha 1)

- Real provider SDK + key management (use the mock seam in A1-5).
- Full docs-pack content generation (#7 tooling).
- Real Next.js app / dependency install inside generated apps.
- Receipt viewer (#21), storage, analytics.
- Autonomous/long-running loops, multi-agent orchestration.
- Sandbox runner changes (consume as-is).
- Any Pi integration.
