# OAF Stack 0.1 Verification

- **Snapshot authority:** `config/stack/oaf-stack-0.1.json`
- **Snapshot ID:** `0.1.0`
- **Verified:** 2026-07-10
- **Policy:** foundational components prefer at least 30 days of age; normal
  dependencies prefer 7-14 days. All selections below meet the applicable
  preference. This document is **evidence**, not a second version authority.

## Official-source evidence

All npm entries were verified through the official npm registry version
metadata. `stable` means the selected registry version has no prerelease label;
it does not mean the package is an LTS release.

| Snapshot key | Selected version | Official source | Release date | Age result | Important constraints / rationale |
| --- | --- | --- | --- | --- | --- |
| `runtime.node` | `24.15.0` | [Node release index](https://nodejs.org/dist/index.json) | 2026-04-15 | Foundational, 86 days: pass | Active LTS (`Krypton` in the official index); selected over 24.18.0 because the newer patch was only 17 days old. |
| `runtime.pnpm` | `11.5.2` | [npm registry](https://registry.npmjs.org/pnpm/11.5.2) | 2026-06-05 | Foundational, 35 days: pass | Declares Node `>=22.13`; compatible with Node 24.15.0. |
| `framework.next` | `16.2.7` | [npm registry](https://registry.npmjs.org/next/16.2.7) | 2026-06-01 | Foundational, 39 days: pass | Declares Node `>=20.9.0`; peer range accepts React/React DOM 19. |
| `framework.react` | `19.2.7` | [npm registry](https://registry.npmjs.org/react/19.2.7) | 2026-06-01 | Foundational, 39 days: pass | Must exactly match React DOM. |
| `framework.reactDom` | `19.2.7` | [npm registry](https://registry.npmjs.org/react-dom/19.2.7) | 2026-06-01 | Foundational, 39 days: pass | Peer requires `react ^19.2.7`; exact match selected. |
| `framework.typescript` | `6.0.3` | [npm registry](https://registry.npmjs.org/typescript/6.0.3) | 2026-04-16 | Foundational, 85 days: pass | Declares Node `>=14.17`; selected stable TypeScript 6 rather than newer TypeScript 7. |
| `data.postgresImage` | `postgres:18.3-bookworm` | [official Docker Hub tag](https://hub.docker.com/_/postgres/tags?name=18.3-bookworm) | 2026-05-09 | Foundational, 62 days: pass | Exact active tag; selected over 18.4-bookworm because the newer tag was only 3 days old. |
| `data.drizzleOrm` | `0.45.2` | [npm registry](https://registry.npmjs.org/drizzle-orm/0.45.2) | 2026-03-27 | Foundational, 105 days: pass | PostgreSQL peer accepts `pg >=8`; paired with pg 8.21.0. |
| `data.drizzleKit` | `0.31.10` | [npm registry](https://registry.npmjs.org/drizzle-kit/0.31.10) | 2026-03-17 | Normal, 115 days: pass | Better Auth 1.6.14 peer requires `>=0.31.4`. |
| `data.pg` | `8.21.0` | [npm registry](https://registry.npmjs.org/pg/8.21.0) | 2026-05-18 | Normal, 53 days: pass | Declares Node `>=16`; satisfies Drizzle `pg >=8` and Better Auth `pg ^8`. |
| `app.betterAuth` | `1.6.14` | [npm registry](https://registry.npmjs.org/better-auth/1.6.14) | 2026-06-02 | Foundational, 38 days: pass | Peers accept Next 16, React/React DOM 19, Drizzle ORM `^0.45.2`, Drizzle Kit `>=0.31.4`, and pg `^8`. |
| `app.zod` | `4.4.3` | [npm registry](https://registry.npmjs.org/zod/4.4.3) | 2026-05-04 | Normal, 67 days: pass | Better Auth 1.6.14 depends on Zod `^4.3.6`; this exact direct pin satisfies that range. |
| `app.tailwindcss` | `4.2.4` | [npm registry](https://registry.npmjs.org/tailwindcss/4.2.4) | 2026-04-21 | Foundational, 80 days: pass | Mature Tailwind 4 release; selected over newer 4.3.2 because that version was only 11 days old. |
| `app.tailwindPostcss` | `4.2.4` | [npm registry](https://registry.npmjs.org/%40tailwindcss%2Fpostcss/4.2.4) | 2026-04-21 | Foundational, 80 days: pass | Official package depends on `tailwindcss 4.2.4`; exact matching pair required. |
| `testing.vitest` | `4.1.8` | [npm registry](https://registry.npmjs.org/vitest/4.1.8) | 2026-06-01 | Normal, 39 days: pass | Engine accepts Node `>=24`; Vite peer/dependency range accepts Vite 6-8. |
| `testing.playwright` | `1.60.0` | [npm registry](https://registry.npmjs.org/playwright/1.60.0) | 2026-05-11 | Foundational, 60 days: pass | Declares Node `>=18`; package resolution was verified without browser download. |

## Temporary compatibility probe

The probe ran outside the tracked repository at `/tmp/opencode/stack-probe`.
It used the official Node 24.15.0 Linux x64 archive from
`nodejs.org/dist/v24.15.0`, verified against the official `SHASUMS256.txt`.
The host Node was `v20.19.4`, so it was **not** used for the probe.

| Item | Evidence |
| --- | --- |
| Runtime | Node `v24.15.0` (official archive checksum verified) |
| Package manager | Corepack invoked `pnpm@11.5.2`; reported `11.5.2` |
| Install | `pnpm install --ignore-scripts --store-dir <temporary-store>` completed with all 13 direct probe packages |
| Next / React / React DOM | Exact package versions resolved together: Next 16.2.7, React 19.2.7, React DOM 19.2.7 |
| TypeScript | `pnpm exec tsc --version` reported `6.0.3` |
| Drizzle | `pnpm exec drizzle-kit --version` reported Kit 0.31.10 and ORM 0.45.2 |
| Better Auth | ESM import of `better-auth` succeeded under Node 24.15.0 |
| Tailwind | ESM import of `@tailwindcss/postcss` succeeded; exact 4.2.4 pair resolved |
| Vitest | `pnpm exec vitest --version` reported 4.1.8 under Node 24.15.0 |
| Playwright | `pnpm exec playwright --version` reported 1.60.0; install used `--ignore-scripts`, so no browser download occurred |

The probe proves package-resolution and selected CLI/import compatibility only.
It did **not** run a Next build/dev server, create an auth flow, connect Drizzle
to PostgreSQL, run Vitest tests, download/run Playwright browsers, or validate a
full generated app. Those remain future generated-app integration work.
