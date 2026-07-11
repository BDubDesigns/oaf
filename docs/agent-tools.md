# OAF Agent Tools (Alpha 1)

This document defines the **fixed** tool set available to the tiny OAF-owned
agent loop (Alpha 1). It is about **contracts and boundaries**, not execution.
Tool bodies are implemented in later issues (A1-3, A1-4); this doc and
`lib/agent/tools.mjs` pin the surface.

The registry is the source of truth for the loop, tests, and receipts.

## Design principles

- **Fixed surface.** Exactly five tools. No dynamic tool discovery, no
  arbitrary tools, no user-supplied tool plugins. The loop reads the registry
  and only those tools exist.
- **OAF owns the boundaries.** The model proposes actions; OAF decides whether
  and how they execute (doctrine §7, `docs/sandbox.md`).
- **No raw shell.** The only process-executing tool is `command`, and it routes
  through `oaf sandbox run`. The agent never receives a shell.
- **Greenfield OAF apps only.** All file tools are scoped to the `oaf init`-
  generated project root. They must reject parent directories and symlink
  escapes.
- **Receiptable by construction.** Every tool declares the `AgentEvent` types
  it emits and a JSON-schema-like result shape, so receipts can aggregate runs
  without special-casing.

## Tool boundary model

OAF splits execution into two trust zones:

| Zone | Tools | Execution | Isolation |
| --- | --- | --- | --- |
| In-process, trusted | `read`, `list`, `grep`, `write` | Runs in the loop's own process | Workspace-bounded by path; **not** containerized |
| Sandboxed, proposed | `command` | Runs via `oaf sandbox run` | Containerized, policy-enforced, project dir only |

This split is deliberate: reads and file writes are schema-constrained and
bounded to one project root, so they stay fast and do not need a container.
`command` can run arbitrary processes, so it is always sandbox-routed. Both
zones honor the **same project-root boundary** — `read` may not read `/etc`
any more than `command` can.

## In-process file execution (issues #29, #36)

`lib/agent/tool-execution.mjs` implements the `read`, `list`, `grep`, and
`write` tool bodies. Each requires an explicit `workspaceRoot` supplied by
OAF's future loop; it is execution context, not an agent-visible tool argument.
The module uses Node built-ins only and never executes a shell command or
accesses the network.

It rejects absolute paths, `..` traversal, resolved paths outside the real
workspace root, and requested symlinks that resolve outside that root. During
recursive `list` and `grep`, nested symlinks are never followed. This mirrors
the sandbox's project-only mount boundary for in-process file tools.

`command` is implemented separately through the shared sandbox seam
`runSandboxCommand` in `lib/sandbox.mjs` (issue #30). Both `oaf sandbox run`
and `executeCommand` use that same policy evaluation and container execution
path. The agent tool contains no process-spawn, shell, or unsandboxed fallback
path.

## Fixed tool set

| Tool | Kind | Mutates | Sandbox | Filesystem |
| --- | --- | --- | --- | --- |
| `read` | read | no | no | read |
| `list` | read | no | no | read |
| `grep` | read | no | no | read |
| `write` | write | yes | no | write |
| `command` | command | yes | **yes** | write |

## Per-tool contracts

### `read`
- **Purpose:** read a file, optionally a line range.
- **Args:** `{ path: string, startLine?: integer, endLine?: integer }`.
- **Result:** `{ path, content, truncated }`.
- **Read-only, workspace-bounded**, in-process. No sandbox.
- **Emits:** `tool_call`, `tool_execution_start`, `tool_execution_end`, `tool_result`.
- **Safety:** reject paths outside the project root; no symlink escapes.
- **Execution:** UTF-8 only. Ranges are 1-based and inclusive. Full reads
  preserve the file contents; ranged reads return the selected lines and set
  `truncated` only when lines were omitted. Alpha 1 adds no output-size cap.
- **Non-goals:** editing, writing, executing.

### `list`
- **Purpose:** list entries in a directory.
- **Args:** `{ path: string, recursive?: boolean }`.
- **Result:** `{ path, entries: [{ name, type }] }`.
- **Read-only, workspace-bounded**, in-process. No sandbox.
- **Emits:** same as `read`.
- **Safety:** same workspace boundary.
- **Execution:** `recursive: true` is supported; recursive entry names are
  relative to the requested directory. Symlinks are listed as `other` and are
  never traversed.
- **Non-goals:** recursive filesystem walking outside the project.

### `grep`
- **Purpose:** search file contents for a pattern.
- **Args:** `{ pattern: string, path?: string, glob?: string }`.
- **Result:** `{ matches: [{ path, line, text }] }`.
- **Read-only, workspace-bounded**, in-process. No sandbox.
- **Emits:** same as `read`.
- **Safety:** same workspace boundary; never reads outside the project.
- **Execution:** plain substring matching, not regular expressions. It walks
  regular files recursively from `path` (default project root), skips files
  containing a NUL byte, and supports a small workspace-relative glob syntax:
  `*`, `?`, and `**`. Alpha 1 adds no match-count cap.
- **Non-goals:** replacing/editing matches.

### `write`
- **Purpose:** write a whole file.
- **Args:** `{ path: string, content: string }`.
- **Result:** `{ path, bytes }`.
- **Mutating, workspace-bounded**, in-process. No sandbox (it is a
  schema-constrained file write, not a process).
- **Emits:** same as `read`.
- **Safety:** reject paths outside the project root; no symlink escapes. A
  future hardening option is to route writes through the sandbox too, but Alpha
  1 keeps them as bounded in-process ops.
- **Execution:** whole-file replacement only. The parent directory must already
  exist; `write` never creates directory trees. New files are allowed. Existing
  targets must be regular files and are rejected if they are symlinks,
  directories, or other non-regular entries. For new files, OAF first resolves
  and validates the real parent directory before constructing the destination.
- **Atomicity:** write UTF-8 contents to a temporary sibling in the verified
  parent, then rename it over the destination. This prevents a partially
  written destination on normal write failures; temporary files are removed on
  failure. When replacing an existing regular file, OAF applies its captured
  permission mode to the temporary file before rename, preserving executable
  bits and other mode bits. New files keep Node's normal creation mode after
  the process umask is applied.
- **Non-goals:** partial edits, patch/diff application, append-only modes.

### `command`
- **Purpose:** propose a shell command for OAF to run.
- **Args:** `{ command: string, mode?: enum }`.
  - `mode` is a sandbox mode from `docs/sandbox.md`
    (`plan` | `edit` | `test` | `browser` | `install` | `research`).
  - Provider arguments cannot request approval or network access. These are
    trusted host capabilities, never model claims.
- **Result:** `{ exitCode, stdout, stderr, truncated }`.
- **Mutating, sandbox-required.** The loop's `command` body MUST call the
  shared runner used by `oaf sandbox run`; it is **never** a raw `spawn`/shell.
- **Emits:** same as `read`.
- **Safety:** every execution is policy-checked and containerized; only the
  project dir is mounted; Docker socket / home / secrets are off limits.
- **Execution:** `executeCommand` requires an explicit `workspaceRoot` and
  passes it as the sandbox working directory. `mode`, if supplied, must be one
  of `plan`, `edit`, `test`, `browser`, `install`, or `research`; an unknown
  mode is rejected before sandbox execution. Mode records execution intent;
  the existing sandbox command classifier remains the enforcement authority.
  Agent commands requiring approval or network fail closed; the standalone
  human CLI has a separate, trusted `--confirm` / `--network` path.
- **Result behavior:** policy and sandbox-start failures throw structured
  errors. A command that starts returns `exitCode`, `stdout`, `stderr`, and
  `truncated` even when it exits non-zero; non-zero is never reported as success.
  Alpha 1 has no output truncation policy yet, so `truncated` is `false`.
- **Non-goals:** interactive shells, background daemons, arbitrary `npx`/`dlx`.

## `write` vs `edit` — Alpha 1 decision

**Alpha 1 uses `write` only (whole-file write).** No `edit` / patch / diff tool
in Alpha 1.

Rationale:

- **Simpler to test.** A whole-file write has one deterministic outcome.
- **Simpler to receipt.** Receipts can record old-hash → new-hash with no diff
  parsing; file changes stay unambiguous for cheap models and humans.
- **Less ambiguous for cheap models.** Whole-file content avoids the partial-
  state failures that patch languages invite.

`edit` (targeted, line-range patch) may be added later as a *separate, scoped*
issue once the loop shape is proven. It is intentionally out of Alpha 1.

## `command` vs `bash` — decision

**The process tool is named `command`, not `bash`.**

`bash` implies a raw shell the agent drives. `command` signals the OAF safety
story — *the model proposes an action; OAF decides and executes* through the
sandbox. The arg shape (`command`, `mode`) carries model intent only; OAF
policy and trusted host code own authorization.

## Event types emitted

All five tools emit the same four `AgentEvent`s during a run:
`tool_call` → `tool_execution_start` → `tool_execution_end` → `tool_result`.
The loop aggregates these (plus `agent_start` / `turn_start` / `message_*`
/ `receipt_emitted` / `agent_end` from `lib/agent/events.mjs`) into a receipt
(`docs/receipts.md`, ADR 0008).

## What is intentionally not here

- No dynamic tool discovery or registration.
- No `edit` tool (deferred).
- No provider/model integration (A1-5).
- No receipt emitter (A1-6) — it consumes this registry's metadata.

## Relationship to other issues

- #27 — `AgentEvent` model this registry references.
- #29 — workspace-bounded `read` / `list` / `grep` execution bodies.
- #36 — workspace-bounded whole-file `write` execution body.
- #30 — sandbox-routed `command` execution body.
- A1-5 — implement the loop with a provider seam.
- A1-6 — emit a receipt from a run.
- `docs/sandbox.md` — the policy `command` routes through.
- `docs/receipts.md` — the schema the loop aggregates into.
- `docs/planning/alpha-1-plan.md` — the milestone this belongs to.
