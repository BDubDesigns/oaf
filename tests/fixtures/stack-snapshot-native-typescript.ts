import { loadStackSnapshot, validateStackSnapshot, type StackSnapshot } from "../../lib/stack-snapshot.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type ValidateSignature = Assert<Equal<typeof validateStackSnapshot, (snapshot: unknown) => StackSnapshot>>;
type LoadSignature = Assert<Equal<typeof loadStackSnapshot, () => StackSnapshot>>;
type IdIsLiteral = Assert<Equal<StackSnapshot["id"], "0.1.0">>;
type StatusIsLiteral = Assert<Equal<StackSnapshot["status"], "locked">>;

const loaded: StackSnapshot = loadStackSnapshot();
const id: "0.1.0" = loaded.id;
const status: "locked" = loaded.status;
const versions: string[] = [loaded.runtime.node, loaded.runtime.pnpm, loaded.framework.next, loaded.framework.react, loaded.framework.reactDom, loaded.framework.typescript, loaded.data.postgresImage, loaded.data.drizzleOrm, loaded.data.drizzleKit, loaded.data.pg, loaded.app.betterAuth, loaded.app.zod, loaded.app.tailwindcss, loaded.app.tailwindPostcss, loaded.testing.vitest, loaded.testing.playwright];

if (false) {
  const untrusted: unknown = loaded;
  const validated: StackSnapshot = validateStackSnapshot(untrusted);
  // @ts-expect-error Stack snapshots require every section.
  const missingSection: StackSnapshot = { id: "0.1.0", status: "locked", verifiedAt: "2026-07-10", docsPack: "stack-0.1", runtime: loaded.runtime, framework: loaded.framework, data: loaded.data, app: loaded.app };
  // @ts-expect-error Runtime requires pnpm.
  const missingComponent: StackSnapshot = { ...loaded, runtime: { node: "24.15.0" } };
  // @ts-expect-error StackSnapshot object literals reject extra top-level fields.
  const extraTopLevel: StackSnapshot = { ...loaded, extra: true };
  // @ts-expect-error The snapshot ID is the locked literal.
  const wrongId: StackSnapshot = { ...loaded, id: "0.2.0" };
  // @ts-expect-error The snapshot status is the locked literal.
  const wrongStatus: StackSnapshot = { ...loaded, status: "open" };
  // @ts-expect-error Component versions are strings.
  const numericVersion: StackSnapshot = { ...loaded, framework: { ...loaded.framework, next: 1 } };
  // @ts-expect-error Component versions cannot be optional or nullable.
  const optionalVersion: StackSnapshot = { ...loaded, framework: { ...loaded.framework, next: undefined } };
  // @ts-expect-error Sections do not permit arbitrary component names.
  loaded.runtime.arbitrary = "1.2.3";
  void [validated, missingSection, missingComponent, extraTopLevel, wrongId, wrongStatus, numericVersion, optionalVersion];
}

const proof: [ValidateSignature, LoadSignature, IdIsLiteral, StatusIsLiteral] = [true, true, true, true];
void [versions, proof];
process.stdout.write("stack-snapshot-native-typescript:ok");
