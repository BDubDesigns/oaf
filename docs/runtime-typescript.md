# OAF Runtime TypeScript Development

The OAF factory/runtime is pinned to Node `24.16.0` in
`config/runtime/oaf-runtime.json`. The local `.node-version` marker and root
`package.json` engine must match that machine-readable factory-runtime source.
This is separate from the generated-app Stack 0.1 Node pin, which is unchanged
and remains owned by issue #72.

Node 24.16.0 was released on 2026-05-21 and was 52 full days old on
2026-07-12. It is the newest Node 24 LTS patch meeting OAF's 30-day
foundational-dependency preference and Node's stable native type-stripping
minimum of 24.12.0. Node 24.17.0 (2026-06-17, 25 full days) and 24.18.0
(2026-06-23, 19 full days) were too new. Evidence: the
[official Node release archive](https://nodejs.org/dist/index.json).

Development will incrementally move OAF source to erasable `.ts` modules that
Node executes directly. Node strips types but does not type-check, so
`pnpm typecheck` performs strict checking. The current `.mjs` runtime modules
remain unchanged in issue #68, and there is no development build or runtime
loader. `typescript@6.0.3` (released 2026-04-16) and
`@types/node@24.13.2` (released 2026-06-10) are exact, aged pins. On
2026-07-12, TypeScript was 87 full days old and the Node type definitions were
31 full days old, meeting the foundational 30-day preference.

`tsconfig.json` follows Node's native type-stripping recommendation: NodeNext,
ESNext, erasable syntax, verbatim module syntax, and relative-extension
rewriting. `allowImportingTsExtensions` is omitted: the compiler accepts
Node-native `.ts` relative specifiers with `rewriteRelativeImportExtensions`,
which also prepares JavaScript distribution work for #71; the standalone flag
is intended only for no-emit or declaration-only projects. Node itself ignores
`tsconfig.json`, requires explicit relative file extensions, and does not run
`.tsx` files.

The existing checked JavaScript has 991 strict diagnostics at this foundation
point, principally implicit parameters/destructuring, unsafe `unknown` access,
and incomplete object-contract inference. `config/typecheck-baseline.json`
stores normalized `TS code | relative path | line:column` fingerprints without
source text or machine paths. `pnpm typecheck` uses the TypeScript compiler API
to fail on any new fingerprint or larger count while allowing debt to shrink;
`pnpm typecheck:raw` prints the unfiltered compiler inventory. This temporary
baseline is removed by the #69/#70 migration work.

Issue #71 will add compiled JavaScript for installed distribution. Generated
OAF apps remain unchanged here and are tracked by #72. Issues #69 and #70 own
the contract and incremental module migrations.

Sources: [Node TypeScript documentation](https://nodejs.org/api/typescript.html),
[TypeScript `rewriteRelativeImportExtensions`](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html),
[TypeScript `allowImportingTsExtensions`](https://www.typescriptlang.org/tsconfig/allowImportingTsExtensions.html),
[TypeScript 6.0.3 metadata](https://registry.npmjs.org/typescript/6.0.3), and
[`@types/node` 24.13.2 metadata](https://registry.npmjs.org/%40types%2Fnode/24.13.2).
