# OAF Build Receipts

This document defines the OAF build receipt format for Alpha 0. It is a
design/docs slice: it specifies what receipts are, where they live, and the
draft JSON schema. It does **not** implement a viewer or storage backend
(see non-goals).

## What receipts are

A receipt is a structured, machine-readable record of a unit of meaningful
work an OAF agent performs: what it changed, why, what it cost, what it
verified, and whether a human approved it.

Receipts are **audit trails, not marketing summaries**. They exist so agent
work is reviewable after the fact without re-running it.

## Why OAF emits them

OAF's doctrine (§8) says OAF produces receipts for meaningful work. The
point is human-in-the-loop accountability:

- Agents should not silently change dependencies, schema, or metadata.
- Commands run through the sandbox (see `docs/sandbox.md`) must be
  auditable.
- Cost and model usage should be visible, not hidden.
- Failures, skipped checks, warnings, and assumptions must stay visible —
  not polished away.

## Where receipts live

In a generated app, receipts live under:

```text
oaf/receipts/
```

Each receipt is a JSON file, e.g.
`oaf/receipts/2026-07-09T04-19-04Z-<short-id>.json`.

The OAF repo itself may keep factory/internal receipts in a similar
location as implementation lands; the schema is the same.

## JSON-first source of truth

- **Raw receipt JSON is the source of truth.**
- Markdown or pretty-UI views are **renderers**, not canonical storage.
- A renderer may omit or reformat fields, but it must never be the only
  copy. If a human-readable view disagrees with the JSON, the JSON wins.
- Receipts are append-only by reference: a new event updates state by
  writing a new receipt or a clearly versioned update, not by mutating
  history silently.

## Optional human-readable / rendered views

Receipts can be rendered as Markdown summaries or in a viewer. A future
pretty viewer is scoped to **#21**. Renderers should:

- surface the final status prominently,
- preserve failures, warnings, and skipped checks (never hide them),
- link back to the raw JSON for full detail.

## Receipt lifecycle / statuses

A receipt has a top-level `status`. Suggested values:

- `pending` — created, work not started.
- `in_progress` — work running.
- `success` — completed as intended.
- `partial` — completed with documented gaps/assumptions.
- `failed` — did not complete; errors recorded.
- `blocked` — stopped awaiting human approval or a missing capability.
- `needs_review` — finished but requires explicit human sign-off.
- `cancelled` — stopped before completion.

A receipt may transition `pending → in_progress → success|partial|failed|
blocked|needs_review|cancelled`.

## What data receipts capture

See the draft schema below. At minimum, a receipt should capture:

- identity (`schemaVersion`, `id`, `createdAt`, `oafVersion`),
- the app/project and task it belongs to,
- the stack / docs-pack it was built against,
- model/provider usage,
- files created/touched,
- commands run (mirroring sandbox command logs),
- checks/tests executed and their results,
- warnings and assumptions,
- package/install changes,
- screenshots/references (by hash/path, not raw blobs),
- cost (estimate and/or actual if known),
- human review status,
- final outcome and next steps.

## Secret redaction policy

Receipts must **never** store secret values.

- Do not record env var values, tokens, keys, passwords, or connection
  strings.
- Record only: the name/path of a secret, that it was read, and by whom
  (agent/human), with the value **redacted**.
- If a command or file touched a secret, note the path and mark it
  `redacted: true`.
- A renderer must not un-redact.

## Screenshot / reference policy

- Screenshots from browser-review mode (Playwright) may be captured, but
  the receipt stores a **reference**, not the image bytes: a relative path
  and a content hash.
- Keep binary artifacts out of the JSON receipt.
- Do not embed secrets or PII in screenshots used as references; if a
  screenshot might contain sensitive data, mark it and exclude it from
  default rendering.

## Relationship to sandbox command logs

The sandbox command log (see `docs/sandbox.md`) is the low-level record of
each executed command: command, mode, network, mounts, exit code, whether
approval was required/granted, and whether it touched dependencies/schema/
`oaf/` metadata. Receipts **aggregate and contextualize** those logs: a
receipt explains *why* a set of commands ran and what came of them. Command
log entries can be embedded by reference (id) inside a receipt's
`commands` array.

## Relationship to package / install changes

When a package is added, removed, or updated, the change is
**security-relevant** and must be receipted (see `docs/package-policy.md`
and `docs/dependencies.md`). A receipt's `packageChanges` array records:

- the package name and exact pinned version,
- whether it was an install / add / remove / update,
- whether it went through sandbox Install mode and human approval,
- the resulting lockfile diff summary (hash/reference, not full file),
- the allowlist record it maps to.

## Relationship to the future pretty viewer (#21)

Receipts are designed JSON-first precisely so a future viewer (#21) can
render them without owning the data. This issue defines the format; #21
defines the pretty presentation. Do not couple the schema to any one
renderer.

## Draft schema (conceptual)

```json
{
  "schemaVersion": "0.1.0",
  "id": "rcpt_01K2Z9X3Q4",
  "createdAt": "2026-07-09T04:19:04Z",
  "oafVersion": "0.1.0",
  "app": {
    "name": "chores-app",
    "path": "chores-app",
    "oafStack": "0.1.0",
    "docsPack": "stack-0.1"
  },
  "task": {
    "id": "task_abc123",
    "summary": "Scaffold feature: recurring chores",
    "issueRef": "Refs #N"
  },
  "stack": {
    "oafStack": "0.1.0",
    "docsPack": "stack-0.1"
  },
  "usage": {
    "model": "example-model",
    "provider": "example-provider",
    "calls": 14,
    "tokensIn": 18200,
    "tokensOut": 6400
  },
  "files": {
    "created": ["features/chores/components/ChoreList.tsx"],
    "touched": ["features/chores/index.ts"],
    "deleted": []
  },
  "commands": [
    {
      "ref": "log_01K2Z9X3Q5",
      "command": "pnpm test",
      "mode": "test",
      "network": false,
      "exitCode": 0,
      "approvalRequired": false,
      "approvalGranted": null
    }
  ],
  "checks": [
    { "name": "unit", "type": "test", "status": "pass", "detail": "12 passed" }
  ],
  "warnings": [
    "Schema change not yet paired with a migration in this receipt."
  ],
  "assumptions": [
    "Assumed existing Better Auth module covers session scope."
  ],
  "packageChanges": [
    {
      "action": "add",
      "name": "better-auth",
      "version": "1.6.14",
      "allowlisted": true,
      "installMode": true,
      "approved": true,
      "lockfileDiffRef": "oaf/receipts/.../lockfile.diff"
    }
  ],
  "screenshots": [
    { "path": "oaf/receipts/.../home.png", "hash": "sha256:...", "containsSensitive": false }
  ],
  "cost": {
    "estimateUsd": null,
    "actualUsd": 0.021,
    "currency": "USD",
    "notes": "Cloud endpoint, budgeted per docs/stack-snapshots.md."
  },
  "humanReview": {
    "required": true,
    "status": "pending",
    "reviewer": null,
    "approvedAt": null
  },
  "status": "needs_review",
  "outcome": "Feature scaffolded; pending human approval of auth scope.",
  "nextSteps": [
    "Human reviews auth scope assumption.",
    "Run oaf doctor to confirm structure."
  ]
}
```

This schema is **draft** for Alpha 0. It is intentionally broad but not
rigid: implementations may add fields, and renderers should ignore unknown
fields rather than fail.

## Non-goals (this issue)

This issue does **not** create:

- a full receipt history dashboard,
- receipt sharing / publishing,
- auth around receipts,
- database-backed receipt storage,
- analytics / search over receipts,
- a perfect, frozen schema with migrations.

Those may be later issues. The format is versioned (`schemaVersion`) so it
can evolve without breaking old receipts.

## Relationship to other issues

- **#5** sandbox policy — command logs feed receipts.
- **#6** package policy — package changes are recorded in receipts.
- **#4** app structure — receipts live in `oaf/receipts/`.
- **#7** docs pack — docs-pack version is recorded in each receipt.
- **#8** `oaf init` — generates the `oaf/receipts/` directory.
- **#10** (this) defines the format.
- **#21** — future pretty receipt viewer (renders, does not own, the JSON).

See also:

- `docs/sandbox.md`
- `docs/package-policy.md`
- `docs/decisions/0008-build-receipt-format.md`
