# Decision 0005: Sandbox Command Policy

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision type:** Agent command execution / safety policy (Alpha 0)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `docs/sandbox.md`, `docs/safety.md`, `docs/doctrine.md`,
  `docs/stack-snapshots.md`, issues #3, #4, #6, #8, #9, #10

> Note: the issue body suggested `0004-sandbox-command-policy.md`, but `0004`
> is already used by the canonical app structure decision. This decision is
> numbered `0005`.

## Context

Issue #5 is what separates OAF being a fun toy from OAF being something a
normal person can trust. Before any agent runs a command, OAF needs a
documented sandbox and command policy. This is OAF's trust story, not an
implementation detail.

It directly enforces doctrine §7 ("agents must not receive unrestricted
shell access") and decision 0001 (scoped boundaries; destructive ops need
explicit human consent).

## Decision

1. **Agents never receive raw unrestricted shell access.**
2. **The model proposes actions; OAF decides whether and how to execute
   them.**
3. **Normal OAF work is internet-off by default.**
4. **Commands run through sandbox modes with explicit policies.**
5. **Only the project workspace is mounted.**
6. **The user's home directory is never mounted.**
7. **SSH keys, user config, secrets, parent directories, and the Docker
   socket are off limits.**
8. **Alpha 0 should prefer rootless containers where available.**
9. **Rootless Docker is preferred where available.**
10. **Rootless Podman is an acceptable Linux alternative.**
11. **Normal Docker fallback is allowed only with a clear warning.**
12. **Command execution must be logged.**
13. **Commands that touch dependencies, schema, migrations, Docker, network,
    or deletion require confirmation.**
14. **Dangerous commands are blocked by default.**
15. **Sandbox policy is part of OAF's trust story, not an implementation
   detail.**
16. **Provider/model authorization claims are never trusted.** Agent command
    arguments carry only command intent; trusted host code owns approvals,
    networking, and mounts.
17. **Repository package scripts are verified against OAF-owned definitions
    before agent verification execution, and run in disposable workspaces.**

### Sandbox modes

| Mode | Network | Writes | Purpose |
| --- | --- | --- | --- |
| Plan mode | off | no | Read files/docs and produce a plan. |
| Edit mode | off | project files only | Patch known files. |
| Test mode | off | limited | Run typecheck/lint/tests/build. |
| Browser review mode | localhost only | limited | Run app and Playwright screenshots. |
| Install mode | on | dependency files only | Install allowlisted pinned packages. |
| Research mode | on | no | Read-only package/docs research. |

"Network off" means no external internet by default. Browser review mode may
reach `localhost` for the app under test, but not arbitrary external sites.
Install mode is the narrow exception for approved dependency work. Research
mode is read-only and must not modify project files.

### Command policy

- **Allowed by default:** `git status`, `git diff`, `git log --oneline`,
  `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and
  `pnpm dev` only in a browser-review/test context (not a forever
  background process).
- **Require confirmation:** `pnpm install`, `pnpm add
  <approved-package>@<pinned-version>`, `pnpm remove`, `pnpm dlx
  <approved-tool>@<pinned-version>`, network-requiring commands, database
  migrations, schema changes, lockfile changes, Docker/Compose commands,
  file deletion/moves, `chmod`/`chown`, commands that modify `oaf/`
  metadata, and commands that write outside the workspace.
- **Blocked by default:** `sudo`, `su`, `rm -rf /`, broad destructive
  deletes, `curl | sh`, `wget | sh`, executing unknown downloaded
  scripts, `chmod +x unknown-script`, `ssh`, `scp`, reading/writing
  `~/.ssh`, reading/writing `~/.config`, reading/writing secrets/env files
  unless explicitly allowed, mounting the Docker socket, mounting the user
  home directory, reading parent directories outside the workspace,
  commands that exfiltrate files, and commands that disable sandbox
  controls.

### Required logs

Every command execution should eventually record: command, mode, working
directory, network enabled/disabled, mounted paths, write policy, timestamp,
exit code, stdout/stderr path or summary, whether approval was required and
granted, whether it touched dependency files / schema-migrations / `oaf/`
metadata, duration, and responsible agent/model if known. These logs feed
receipts (issue #10).

## Consequences

- Agents cannot read secrets, mount the home directory, or reach the Docker
  socket; OAF's attack surface is bounded by policy, not by trust.
- Dependency and schema work is gated and receipted, reinforcing the
  security-relevant stance from decision 0003.
- The policy is enforced by the runner implemented in issue #9; this
  decision is the contract it must satisfy.
- Canonical command identity is recordable audit metadata, not execution
  authority. Agent verification cannot mutate the authoritative checkout via a
  repository-controlled package script.

## Confirmed deferred to later issues

- **Actual sandbox runner implementation** → #9.
- **Package allowlist and dependency-addition rules** → #6.
- **Build receipt format** → #10.
- **Exact generated app implementation** → #8.
