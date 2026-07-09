# OAF Sandbox & Command Policy

This document defines how OAF executes commands for agents. It is part of
OAF's trust story, not an implementation detail. It must be in place
**before** any agent is allowed to run commands.

## Core principle

> The model may propose actions, but only OAF can execute commands.

Agents must **never** receive raw, unrestricted shell access. Every command
goes through an OAF-controlled runner that applies policy, sandboxing,
logging, and user-confirmation rules.

OAF decides **whether** and **how** a proposed action executes. The agent
proposes; OAF executes.

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
- `pnpm dev` **only** in a browser-review / test context — not as a
  background-forever process.

## Require confirmation

These are allowed only after explicit user approval:

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
- `docs/decisions/0005-sandbox-command-policy.md`
- `docs/doctrine.md`
