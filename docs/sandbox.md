# OAF Sandbox & Command Policy

This document defines how OAF executes commands for agents. It is part of
OAF's trust story, not an implementation detail. It must be in place
**before** any agent is allowed to run commands.

## Core principle

> The model may propose actions, but only OAF can execute commands and grant
> authorization capabilities.

Agents must **never** receive raw, unrestricted shell access. Every command
goes through an OAF-controlled runner that applies policy, sandboxing,
logging, and user-confirmation rules.

OAF decides **whether** and **how** a proposed action executes. The agent
proposes; OAF executes.

For agent runs, the model proposes, OAF policy classifies, and trusted host
code authorizes. Provider arguments never prove human approval, network access,
mount policy, or write authority. Until an interactive CLI approval path is
connected to agent runs, commands requiring approval or network are rejected.

## Verification execution

Recordability is not execution trust. Before an agent can run a canonical
`pnpm` verification command, OAF verifies an OAF-owned blessed script
definition, exact pinned package-manager metadata, and no unowned `pre`/`post`
lifecycle hook. Pnpm 11 project execution settings live in
`pnpm-workspace.yaml`; because Alpha 1 does not generate or own it, any such
file is rejected wholesale. `.pnpmfile.mjs` and `.pnpmfile.cjs` are likewise
rejected. `.npmrc` is excluded from the disposable copy as auth/registry
configuration, not parsed as a script-shell setting. Sandbox containment does
not prove repository code benign; this prevents package-script indirection.

Agent package verification runs in a disposable copy outside the authoritative
project. The copy excludes `.git`, `oaf/receipts`, `.npmrc`, every basename
beginning `.env`, `node_modules`, and symlinks; authoritative `node_modules`,
when present, is mounted read-only.
The disposable copy is writable at `/workspace`, network is always off, and it
is removed after every outcome. Canonical Git inspection commands mount the
authoritative project read-only.

Agent `git diff` is disabled pending a safe output design: diff output can
contain tracked secret data outside file-tool path controls. `git status` and
`git log --oneline` remain read-only agent commands. This is path-based
protection, not general secret detection; ordinary allowed source tool results
may still be sent to the configured provider.

## Default stance: internet-off

Normal OAF work is **internet-off by default**. "Network off" means no
external internet access unless the active sandbox mode explicitly enables it.
This keeps dependency installs, research, and normal edits deliberate and
visible, and reduces exfiltration and supply-chain surface.

## Sandbox modes

| Mode | Network | Writes | Purpose |
| --- | --- | --- | --- |
| Plan mode | off | no | Read files/docs and produce a plan. |
| Edit mode | off | project files only | Patch known files. |
| Test mode | off | limited | Run typecheck / lint / tests / build. |
| Browser review mode | localhost only | limited | Run app and Playwright screenshots. |
| Install mode | on | dependency files only | Install allowlisted pinned packages. |
| Research mode | on | no | Read-only package/docs research. |

Nuance:

- **Network off** means no external internet by default.
- **Browser review mode** may reach `localhost` for the app under test, but
  must not reach arbitrary external sites.
- **Install mode** is the narrow exception for approved dependency work; it
  is the only mode that turns network on for writes, and writes are limited
  to dependency files.
- **Research mode** is read-only and must not modify project files.

## Mounting and isolation

- Only the **project workspace** is mounted.
- The **user's home directory is never mounted**.
- **SSH keys, user config, secrets, parent directories, and the Docker
  socket are off limits**.

## Container stance

- Alpha 0 should prefer **rootless containers** where available.
- **Rootless Docker** is preferred where available.
- **Rootless Podman** is an acceptable Linux alternative.
- **Normal Docker fallback** is allowed only with a clear warning.

## Allowed by default

These run without confirmation in the appropriate mode:

- `git status`
- `git diff`
- `git log --oneline`
- `pnpm test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`

Allowlisted commands are matched **exactly** (no shell chaining). A command
like `pnpm test; pnpm install` or `pnpm test && echo hi` is **not**
allowlisted; the appended part requires its own policy check. `pnpm dev` is
**not** allowlisted by default — see below.

## Require confirmation

These are allowed only after explicit user approval, passed as the
`--confirm` flag to `oaf sandbox run`. **Without `--confirm`, confirmation-
required commands fail closed.** Blocked commands stay blocked even with
`--confirm` (it is approval, not a bypass).

- `pnpm dev` (run a dev server — only appropriate in a browser-review /
  test context, and only with explicit `--confirm`)
- `pnpm install`
- `pnpm add <approved-package>@<pinned-version>`
- `pnpm remove`
- `pnpm dlx <approved-tool>@<pinned-version>`
- commands requiring external network
- database migrations
- schema changes
- lockfile changes
- Docker or Compose commands
- file deletion or moves
- `chmod` / `chown`
- commands that modify generated-app metadata under `oaf/`
- commands that write outside the workspace

## Blocked by default

These are denied outright:

- `sudo`
- `su`
- `rm -rf /`
- broad destructive deletes
- `curl | sh`
- `wget | sh`
- executing unknown downloaded scripts
- `chmod +x unknown-script`
- `ssh`
- `scp`
- reading or writing `~/.ssh`
- reading or writing `~/.config`
- reading or writing secrets / env files unless explicitly allowed
- mounting the Docker socket
- mounting the user home directory
- reading parent directories outside the workspace
- commands that exfiltrate files
- commands that disable sandbox controls

## Required command logs

Every command execution should eventually record:

- command
- mode
- working directory
- network enabled / disabled
- mounted paths
- write policy
- timestamp
- exit code
- stdout / stderr path or summary
- whether user approval was required
- whether approval was granted
- whether the command touched dependency files
- whether the command touched schema / migrations
- whether the command touched `oaf/` metadata
- duration
- responsible agent / model, if known

These logs feed OAF's receipts (issue #10) and make agent work auditable.

## CLI command

OAF provides a minimal runner (issue #9):

```text
oaf sandbox run "pnpm test"
oaf sandbox run "pnpm typecheck"
oaf sandbox run --network "pnpm install"
oaf sandbox status
```

- `oaf sandbox run <command>` enforces this policy **before** execution:
  denied commands are rejected; confirmation-required commands need
  `--confirm`; network-required commands need `--network`.
- When a container runtime (Docker or Podman) is available, the command runs
  inside a locked-down container: only the project directory is mounted,
  network is off by default, and the Docker socket / user home are never
  mounted.
- `oaf sandbox status` reports whether a container runtime is available.
- Receipt emission, agent integration, and package-allowlist config are
  intentionally out of scope for this first slice (see issues #10, #6).

## Relationship to other issues

- **#3** defines the blessed stack.
- **#14** defines stack snapshots and dependency pinning.
- **#4** defines where generated app files live.
- **#5** (this) defines sandbox command policy.
- **#6** defines package allowlist / dependency-addition rules.
- **#7** defines docs pack format.
- **#8** implements minimal `oaf init`.
- **#9** implements the minimal sandbox runner.
- **#10** defines build receipt format.

See also:

- `docs/safety.md`
- `docs/receipts.md` — how command logs feed structured receipts.
- `docs/decisions/0005-sandbox-command-policy.md`
- `docs/doctrine.md`
