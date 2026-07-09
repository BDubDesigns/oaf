# OAF — Opinionated App Factory

OAF is an all-in-one, lightweight coding agent and app factory.

The core thesis is simple:

> OAF does not try to understand every codebase.
> OAF creates codebases that are easy for coding agents to understand.

Most coding tools try to be smart about arbitrary code. OAF takes the
opposite bet. It makes a small number of strong choices up front so that
the resulting apps are predictable, legible, and cheap to keep running —
both for humans and for the agents that build and maintain them.

## What this repo is

This repository is the start of OAF. This first commit is documentation
only. It locks the product shape before any implementation begins, so
that later decisions have a stable foundation to build on.

See:

- [`docs/doctrine.md`](docs/doctrine.md) — the beliefs OAF is built on.
- [`docs/non-goals.md`](docs/non-goals.md) — what OAF explicitly will not do (for now).
- [`docs/stack.md`](docs/stack.md) — the one blessed app stack for Alpha 0.
- [`docs/sandbox.md`](docs/sandbox.md) — sandbox and command execution policy.
- [`docs/safety.md`](docs/safety.md) — OAF's safety posture.
- [`docs/decisions/0001-product-shape.md`](docs/decisions/0001-product-shape.md) — the first recorded decision.

## Status

Pre-implementation. Documentation and product definition only. No code yet.

## License

AGPLv3. See [LICENSE](LICENSE).
