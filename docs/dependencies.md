# OAF Dependencies

This document explains how OAF controls dependencies so agents cannot install
random npm packages or lean on unsafe `latest` / `npx` / `pnpm dlx`
patterns. It pairs with `docs/package-policy.md` and
`docs/stack-snapshots.md`.

Core principle:

> The agent does not choose new packages by default.

OAF owns the blessed dependency set. The agent may **propose** a package
request, but additions require explicit policy approval, an exact pinned
version, sandbox Install mode, and a receipt (issues #5, #10).

## pnpm is mandatory

Generated OAF apps use **pnpm** (Alpha 0, decision 0002). The lockfile
is `pnpm-lock.yaml`, installed frozen by default (decision 0003). Other
package managers are not supported for generated apps in Alpha 0.

## Blessed set, not a menu

- OAF owns the blessed dependency set (defined by the stack snapshot, #3/#14).
- Direct dependency versions must be **exact pins** — no caret/tilde ranges.
- Generated apps **commit `pnpm-lock.yaml`**; the lockfile freezes the
  full resolved graph (direct + transitive).
- **`@latest` is banned** in generated apps.
- **Arbitrary `npx` is banned.**
- **Arbitrary `pnpm dlx` is banned.**

## Allowed install patterns

| Pattern | Allowed? | Condition |
| --- | --- | --- |
| `pnpm install` | confirmation | sandbox Install mode |
| `pnpm add <approved>@<pin>` | confirmation | allowlisted package + approved pin |
| `pnpm remove <approved>` | confirmation | allowlisted package |
| `pnpm dlx <approved-tool>@<pin>` | confirmation | allowlisted tool + pinned version, Install mode |
| `npx <anything>` | **no** | banned |
| `pnpm dlx <unknown>` | **no** | banned |
| `pnpm add <unknown>` | **no** | must go through package request flow |

## Transitive dependencies

Transitive deps are **not** trusted blindly. They are controlled through:

- the committed lockfile,
- sandbox policy (frozen, reviewed installs),
- the review / receipt process.

A lockfile diff is a supply-chain diff. Treat it as security-relevant
(decision 0003, #5 logging).

## Release-age policy (aligns with stack-snapshots.md)

- Normal dependencies: usually **7–14 days old** before inclusion.
- Foundational dependencies: preferably **30 days old** before inclusion.
- No **beta / canary / rc** in default generated apps.
- No `latest`, no floating ranges.

## Stack update policy

Packages in an OAF stack snapshot (e.g. Stack 0.1) are updated through
**explicit stack upgrades**, not ad hoc `pnpm update`. An upgrade is a
deliberate, receipted change (see `docs/stack-snapshots.md` and the future
`oaf update-stack` concept).

## Docs-pack alignment

If a package is allowed, OAF's local docs pack should include docs
compatible with that package/version line. Agents should not rely on docs for
unrelated major versions (issue #7).

## Relationship to other docs

- `docs/package-policy.md` — the allowlist and package-request flow.
- `docs/sandbox.md` — Install mode requirements.
- `docs/stack-snapshots.md` — pinning and snapshot policy.
- `docs/decisions/0006-package-allowlist-policy.md` — the recorded decision.
