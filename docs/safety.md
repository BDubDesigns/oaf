# OAF Safety

This document states OAF's safety posture in plain terms. Safety is a
product feature, not a checkbox. An agent that can silently run anything is
not a tool a normal person can trust.

## Agents do not get a shell

OAF agents never receive raw, unrestricted shell access. The model proposes
actions; OAF's controlled runner decides whether and how they execute. This
is doctrine, not an option (see `docs/doctrine.md` §7 and decision 0001).

## Why a sandbox at all

The difference between OAF being a fun toy and OAF being something a normal
person can trust is exactly this boundary:

- The agent cannot read your SSH keys, user config, or secrets.
- The agent cannot mount your home directory or the Docker socket.
- The agent cannot exfiltrate files or disable its own controls.
- The agent cannot install whatever it wants; dependency work is gated and
  pinned (see `docs/stack-snapshots.md` and issue #6).

## Default-deny, confirm-gated

OAF's command policy is **default-deny with confirmation gates**:

- Harmless, read-only, and known-safe commands are allowed by default
  (see `docs/sandbox.md`).
- Risky commands require explicit user approval.
- Dangerous commands are blocked outright.

When in doubt, OAF asks. It does not broaden its own authority.

## Isolation boundaries

- Only the project workspace is mounted.
- The user's home directory is never mounted.
- SSH keys, user config, secrets, parent directories, and the Docker socket
  are off limits.
- Alpha 0 prefers rootless containers; normal Docker is a warned fallback.

## Visibility

Every command execution is logged and, for meaningful work, produces a
receipt (issue #10). You should be able to see what OAF ran, with what
policy, whether it touched dependencies/schema/metadata, and whether you
approved it.

## Relationship to other docs

- `docs/sandbox.md` — the concrete command/mode/allow/block policy.
- `docs/decisions/0005-sandbox-command-policy.md` — the recorded decision.
- `docs/doctrine.md` — §5–§7 (no invented architecture, no random
  packages, no unrestricted shell).
- `docs/stack-snapshots.md` — dependency pinning and supply-chain policy.
