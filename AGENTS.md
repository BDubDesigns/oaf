# AGENTS.md

Strict working rules for coding agents in this repository. Follow these
exactly. When in doubt, ask; do not guess and broaden.

## 1. Project identity

OAF = Opinionated App Factory. A safe, convention-locked coding
agent/app factory that builds **one blessed web app stack** the same way
every time.

Core thesis (read it until it is instinct):

> OAF does not try to understand every codebase.
> OAF creates codebases that are easy for coding agents to understand.

Greenfield-only at first. One blessed stack at first. Strict conventions
are a product feature, not a burden.

## 2. Required workflow

Before doing any issue work, read:

- `README.md`
- `docs/doctrine.md`
- `docs/non-goals.md`
- `docs/stack.md` (once it exists — see issue #3)
- every file under `docs/decisions/*.md` relevant to the issue

Then work the single assigned issue only.

## 3. Branch and PR rules

- Work **one GitHub issue at a time**.
- **Always create a branch** for issue work unless explicitly told not to.
- Branch names are short and scoped: `docs/blessed-stack-v0`, `feat/oaf-init`.
- PR titles should be scoped and conventional when possible: `docs: define blessed stack v0`, `feat: add oaf init`, `chore: add agent instructions`.
- **Never commit directly to `main`** unless explicitly instructed.
- **Never merge PRs.** That is a human action.
- Open **draft PRs** by default. Only mark a PR ready when explicitly told.
- Do not push a branch or merge without showing the diff first, unless explicitly instructed to push/open a PR.

## 4. Issue-linking rules

- PR fully resolves an issue → body must include `Closes #<n>`.
- PR only partially addresses an issue → use `Refs #<n>`.
- Never claim closure of an issue the PR does not finish.
- Do not manually close issues unless explicitly instructed. Prefer issue closure through a merged PR containing `Closes #<n>`.

## 5. Scope discipline

- Keep changes small and scoped to the issue.
- Do **not** broaden into adjacent issues (#3–#11, etc.).
- If an issue is documentation-only, do **not** implement code.
- If you spot unrelated problems, note them; do not fix them in-scope.

## 6. Dependency / package rules

- Do **not** add dependencies unless the issue explicitly allows it.
- Do **not** use `@latest` or unpinned versions.
- Do **not** create `package.json` or install packages unless the current
  issue calls for implementation.
- Adding a dependency is a visible, deliberate act — never agent-initiated.

## 7. Safety / security rules

- Do **not** touch sandbox / security / package policy casually
  (issues #5, #6 own these).
- Agents must **not** invent architecture. App structure is decided by the
  factory, not discovered at generation time.
- Agents must **not** receive unrestricted shell access. Stay within scoped,
  reviewed boundaries; destructive ops need explicit human consent.
- Preserve `LICENSE` (AGPLv3). Never overwrite it.

## 8. Documentation-first rules

- Prefer editing existing files when they are the right home. Create new files only when the issue or repo structure calls for them.
- Match existing style, naming, and structure.
- Every product decision that outlives the moment belongs in
  `docs/decisions/NNNN-*.md`, not in chat.
- OAF should produce **receipts** for meaningful work (issue #10 defines
  the format). For now, summarize what changed, why, cost, and verification.

## 9. Testing / checks expectations

- Alpha 0 currently has **no code and no automated checks**.
- For documentation-only issues, there is nothing to run; say so.
- Do not claim tests/checks passed unless they were actually run.
- If checks were not run, say exactly why.
- Once code lands (#8+), run the repo's lint/typecheck/test before reporting
  done. Trust executable config over prose when they disagree.

## 10. PR template expectations

Every PR must include all of:

- **Summary**
- **Scope**
- **Tests/checks run**
- **Decisions made**
- **Follow-ups / intentionally deferred work**
- **Issue link**

Link the issue per section 4.

## 11. Files agents should avoid staging

- `.directory` (local editor metadata — gitignored).
- Secrets and env files (`.env`, `.env.*`). `.env.example` is fine.
- Random editor/OS files (`.DS_Store`, `Thumbs.db`, `.vscode/`, `.idea/`).
- Generated package files and implementation code unless the issue calls for it.
- Never stage anything you cannot explain.

## 12. Definition of done

A unit of work is done when:

- it resolves only its assigned issue,
- it is on a scoped branch with a draft PR,
- the PR body follows the template and links the issue correctly,
- docs/code match the doctrine in `docs/doctrine.md` and `docs/non-goals.md`,
- the working tree contains no stray or secret files,
- and you have reported exactly what changed and what was verified.

## Alpha 0 issue map

- #2 doctrine & non-goals (completed) — `docs/`
- #3 blessed stack v0
- #4 canonical app structure
- #5 sandbox command policy
- #6 package allowlist / dependency policy
- #7 local docs pack design
- #8 minimal `oaf init`
- #9 minimal sandbox runner
- #10 build receipt format
- #11 Pi integration feasibility spike

OAF is free-first, not necessarily local-first. Local models are an
optional privacy/offline/fallback mode.
