# OAF Package Policy

This document defines the package allowlist and dependency-addition policy
for OAF Alpha 0. It is the human-readable policy; the machine-readable
allowlist is future work (see below).

## Allowlist location (future)

The intended machine-readable location is:

```text
packages/oaf-core/src/dependencies/allowed-packages.json
```

For Alpha 0 (docs-only), the policy is defined here and in
`docs/dependencies.md`. The JSON format below is **conceptual / future**,
not implemented yet.

## Allowlist record format (conceptual)

```json
{
  "name": "better-auth",
  "version": "1.6.14",
  "purpose": "authentication",
  "category": "auth",
  "allowedImports": [
    "better-auth",
    "better-auth/adapters/drizzle"
  ],
  "allowedIn": [
    "server/auth",
    "features/auth",
    "app/api/auth"
  ],
  "docs": [
    "better-auth/index.md",
    "better-auth/drizzle.md"
  ],
  "risk": "medium",
  "requiresNetworkAtInstall": true,
  "approvedBy": "oaf-core",
  "approvedForStacks": [
    "0.1.0"
  ],
  "notes": "Blessed auth path for OAF Stack 0.1"
}
```

### Field meaning

- **`name`** — npm package name.
- **`version`** — exact approved version. Never a range or `latest`.
- **`purpose`** — why OAF allows it.
- **`category`** — stack category, e.g. `auth` / `db` / `ui` / `test` /
  `tooling`.
- **`allowedImports`** — allowed import specifiers.
- **`allowedIn`** — generated-app paths where imports are expected
  (paths follow the canonical structure from `docs/app-structure.md`:
  `server/auth`, `features/auth`, `app/api/auth`).
- **`docs`** — local docs-pack files aligned with this package.
- **`risk`** — `low` / `medium` / `high` policy signal.
- **`requiresNetworkAtInstall`** — whether install needs network.
- **`approvedBy`** — source of approval.
- **`approvedForStacks`** — stack snapshots this package is approved for.
- **`notes`** — human rationale.

## Package request flow (future)

1. Agent discovers a need.
2. Agent checks the current blessed stack and existing allowed packages.
3. Agent explains why existing packages are insufficient.
4. Agent proposes a package request with:
   - package name
   - exact version
   - purpose
   - alternatives considered
   - import paths needed
   - generated-app paths touched
   - network / install requirements
   - risk notes
   - docs-pack requirements
5. Human / OAF policy approves or rejects.
6. An approved package is added to the allowlist through a dedicated
   policy / stack change.
7. Install happens only through sandbox Install mode.
8. Lockfile diff and dependency changes are reviewed.
9. A receipt records the change (issue #10).

## Unapproved package behavior

If an agent wants an unapproved package, it must **not** install it. It
should:

- stop,
- explain the missing capability,
- suggest a blessed alternative if possible,
- create / propose a package request,
- wait for approval.

## Banned by default

- `@latest` in generated apps.
- Arbitrary `npx`.
- Arbitrary `pnpm dlx`.
- `pnpm add <unknown>` outside the allowlist.
- Floating version ranges for direct dependencies.

## Possible future commands (concepts only)

```text
oaf package list
oaf package explain better-auth
oaf package request <name>
oaf update-stack
```

## Relationship to sandbox

Install commands require sandbox **Install mode** (see `docs/sandbox.md`):

- network **on**,
- writes limited to **dependency files**,
- **explicit approval** required,
- only **allowlisted packages** at **pinned versions**,
- command logs and receipts required.

## Relationship to docs packs

If a package is allowed, OAF's local docs pack should include docs
compatible with that package/version line. Agents should not rely on docs
for unrelated major versions (issue #7).

## Relationship to other issues

- **#3** blessed stack · **#14** stack snapshots/pinning · **#4** app
  structure · **#5** sandbox policy · **#6** (this) allowlist/dependency
  policy · **#7** docs pack · **#8** `oaf init` · **#9** sandbox
  runner · **#10** receipt format.

See also:

- `docs/receipts.md` — package/install changes are recorded in receipts.
