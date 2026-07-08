# OAF Non-Goals (Alpha 0)

This document lists what OAF will **not** do for Alpha 0. These are
intentional scope boundaries, not future promises. Some may be revisited
later through decision records; until then, they are out of scope.

## Out of scope for Alpha 0

- **Supporting arbitrary existing repos.**
  OAF supports greenfield OAF apps only at first. It does not ingest,
  refactor, or "understand" pre-existing codebases.

- **Supporting multiple stacks.**
  One stack, chosen and owned by OAF. Not a framework picker.

- **Building a hosted SaaS.**
  OAF is a tool you run, not a service we operate for you.

- **Reselling LLMs or hosting.**
  OAF is not an LLM provider and does not bill for model usage.

- **Full automatic deployment.**
  OAF may prepare an app to run, but it does not own your production
  deployment pipeline.

- **Arbitrary MCP integration.**
  OAF controls its tool surface. Open-ended MCP plugin ecosystems are not
  part of Alpha 0.

- **Autonomous long-running coding loops.**
  OAF is human-in-the-loop. It does not run unattended for long stretches
  without consent and receipts.

- **Package marketplace.**
  No public registry of OAF extensions or plugins for Alpha 0.

- **Team features.**
  No multi-user, collaboration, permissions, or org features yet.

## Why this list exists

Every item above is a place where a coding tool can quietly become a
different, much larger product. OAF's strength is saying no early, so the
yeses stay cheap and predictable.
