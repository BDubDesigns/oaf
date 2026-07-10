# OAF Package Policy

Dependencies are a controlled surface. An agent must not install or add an
unapproved package to unblock itself. Direct dependencies use exact pinned
versions; `@latest`, arbitrary `npx`, arbitrary `pnpm dlx`, and floating
ranges are disallowed.

Package changes require a dedicated approval/policy path, sandbox Install
mode, network access, review of lockfile changes, aligned local docs, and a
receipt. Prefer the existing blessed stack before proposing a package request.
