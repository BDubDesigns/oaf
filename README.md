# OAF — Opinionated App Factory

OAF (Opinionated App Factory) is a convention-locked app factory and
coding-agent environment. It makes a small number of strong choices up front
— one blessed stack, one canonical app structure, and strict safety
guardrails — so the apps it creates are predictable and easy for coding
agents to understand.

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
- [`docs/dependencies.md`](docs/dependencies.md) — dependency control policy.
- [`docs/package-policy.md`](docs/package-policy.md) — package allowlist and addition policy.
- [`docs/docs-pack.md`](docs/docs-pack.md) — local docs pack system for internet-off work.
- [`docs/decisions/0001-product-shape.md`](docs/decisions/0001-product-shape.md) — the first recorded decision.

## Status

Alpha 0. Documentation and product definition are locked (see `docs/`, ADRs
`0001`–`0009`), including the Pi-integration decision (ADR 0009: build a tiny
OAF-owned agent loop; do not wrap or fork Pi). Working primitives exist:

- `oaf init` scaffolds a canonical app skeleton.
- `oaf doctor` validates a generated app.
- `oaf sandbox run` enforces the command policy in a locked-down container.

There is **no agent loop yet** — that is the Alpha 1 milestone
(`docs/planning/alpha-1-plan.md`). The generated app is a skeleton, not a
running Next.js app, and there is no package install or provider integration
yet.

## Usage (Alpha 0, local dev)

OAF is in early implementation. To try the minimal factory primitives:

    node bin/oaf.mjs init chores-app
    cd chores-app
    node oaf/doctor.mjs

Or, from outside the app, point the CLI at it:

    node ../bin/oaf.mjs doctor

Run a sandbox-checked command (see `docs/sandbox.md` for policy):

    node bin/oaf.mjs sandbox run "pnpm test"
    node bin/oaf.mjs sandbox status

Once the `oaf` bin is installed / packaged, the commands shorten to:

    oaf init chores-app
    oaf doctor
    oaf sandbox run "pnpm test"

Run the repo smoke tests with:

    node tests/oaf-init.test.mjs
    node tests/sandbox.test.mjs

## License

AGPLv3. See [LICENSE](LICENSE).
