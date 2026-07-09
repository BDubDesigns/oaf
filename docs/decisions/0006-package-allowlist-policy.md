# Decision 0006: Package Allowlist Policy

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Dependency control policy (Alpha 0)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/dependencies.md`, `docs/package-policy.md`,
  `docs/sandbox.md`, `docs/stack-snapshots.md`, `docs/app-structure.md`,
  issues #3, #4, #5, #7, #8, #9, #10

> Note: the issue body suggested `0005-package-allowlist-policy.md`, but
> `0005` is already used by the sandbox command policy decision. This
> decision is numbered `0006`.

## Context

Issue #6 is a core safety feature: OAF must make package choice
intentional, reviewed, pinned, and recorded. Without it, an agent can
quietly `npm install` a random package or run `curl | sh` via a tool.
This enforces doctrine §6 ("agents must not install random packages")
and decision 0001 ("dependencies are a controlled, reviewed surface").

It is tightly coupled to decision 0003 (pinned snapshots), decision 0005
(sandbox Install mode), and issue #7 (docs-pack alignment).

## Decision

1. **pnpm is mandatory** for generated apps in Alpha 0.
2. **The agent does not choose new packages by default.**
3. **OAF owns the blessed dependency set.**
4. **Direct dependency versions must be exact pins.**
5. **Generated apps commit `pnpm-lock.yaml`.**
6. **`@latest` is banned** in generated apps.
7. **Arbitrary `npx` is banned.**
8. **Arbitrary `pnpm dlx` is banned.**
9. **`pnpm dlx <approved-tool>@<pinned-version>`** may be allowed only
   through sandbox Install mode with approval.
10. **`pnpm add`** may only add allowlisted packages at approved pinned
    versions.
11. **Package installs require sandbox Install mode and explicit
    confirmation.**
12. **Newly published packages are delayed** before OAF allows them.
13. **Transitive dependencies are controlled** through the lockfile, sandbox
    policy, and review/receipt process — not trusted blindly.
14. **Package updates happen through explicit OAF stack updates or explicit
    package-policy changes.**
15. **Dependency changes are security-relevant** and must be reviewable.
16. **Docs packs must align** with allowed packages and pinned versions.
17. **Unapproved package requests become package-request records**, not
    immediate installs.
18. **Agents must suggest using existing blessed dependencies** before
    requesting a new one.

### Policy goals (documented)

Avoid arbitrary package installation; avoid `@latest`; avoid unknown
`npx` / `pnpm dlx`; pin direct dependency versions; commit lockfiles; make
stack updates explicit; make package additions reviewable; keep docs packs
aligned with allowed packages/versions; keep install/network behavior aligned
with `docs/sandbox.md`.

### Allowlist location (future)

Machine-readable allowlist: `packages/oaf-core/src/dependencies/
allowed-packages.json` (future). Alpha 0 defines the human-readable policy
in `docs/dependencies.md` and `docs/package-policy.md`. The JSON record
format is conceptual only and not implemented here.

### Package request flow (future)

Agent discovers need → checks blessed stack / allowed packages → explains
why existing packages are insufficient → proposes a request (name, exact
version, purpose, alternatives, import paths, paths touched, network/
install needs, risk, docs-pack needs) → human / OAF policy approves or
rejects → approved package added to allowlist via a dedicated policy/stack
change → install only through sandbox Install mode → lockfile diff reviewed
→ receipt recorded.

### Unapproved package behavior

If an agent wants an unapproved package, it must **not** install it. It
stops, explains the missing capability, suggests a blessed alternative if
possible, creates/proposes a package request, and waits for approval.

### Release-age policy

Aligns with decision 0003 / `docs/stack-snapshots.md`: normal deps
usually 7–14 days old; foundational deps preferably 30 days old; no
beta/canary/rc; no `latest`; no floating ranges.

### Stack update policy

Stack 0.1 packages update through explicit stack upgrades, not ad hoc
installs. Future concepts: `oaf update-stack`, `oaf package list`,
`oaf package explain <name>`, `oaf package request <name>`.

## Consequences

- Agents cannot expand the dependency surface on their own; additions are
  reviewable, pinned, and receipted.
- Install/network behavior is bounded by sandbox Install mode (decision 0005):
  network on, writes limited to dependency files, explicit approval,
  allowlisted pins only, logs + receipts required.
- Docs packs can be kept version-aligned (issue #7), because allowed
  packages carry exact versions.

## Confirmed deferred to later issues

- **Machine-readable allowlist implementation** → future `oaf-core` config
  work.
- **Minimal `oaf init`** → #8.
- **Sandbox runner enforcement** → #9.
- **Build receipt format** → #10.
- **Docs pack format** → #7.
- **Final Stack 0.1 machine-readable config** → implementation/config
  (carried from #14).
