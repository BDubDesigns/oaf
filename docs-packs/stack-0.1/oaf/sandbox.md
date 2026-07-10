# OAF Sandbox Boundary

The model proposes actions; only OAF executes commands. The `command` tool
uses the same policy-controlled sandbox path as `oaf sandbox run`; it never
gets a raw host shell.

Network is off by default. Commands outside the exact allowlist require
explicit confirmation; blocked commands remain blocked. The sandbox mounts only
the project workspace and never mounts the user home, Docker socket, SSH keys,
or user configuration. Sandbox startup failure must fail closed.
