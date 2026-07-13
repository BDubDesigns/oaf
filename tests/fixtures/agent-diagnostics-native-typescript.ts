import {
  type AgentRunResult,
  type BuildDiagnosticOptions,
  type Diagnostic,
  type DiagnosticToolOutcome,
  type ToolName,
  type WriteDiagnosticOptions,
} from "../../lib/agent/contracts.ts";
import {
  buildDiagnostic,
  normalizeDiagnosticSchema,
  writeDiagnostic,
} from "../../lib/agent/diagnostics.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type NormalizeAcceptsUnknown = Assert<Equal<Parameters<typeof normalizeDiagnosticSchema>[0], unknown>>;
type NormalizeReturnsDiagnostic = Assert<Equal<ReturnType<typeof normalizeDiagnosticSchema>, Diagnostic>>;
type BuildAcceptsContract = Assert<Equal<Parameters<typeof buildDiagnostic>[0], BuildDiagnosticOptions>>;
type BuildReturnsDiagnostic = Assert<Equal<ReturnType<typeof buildDiagnostic>, Diagnostic>>;
type WriteAcceptsContract = Assert<Equal<Parameters<typeof writeDiagnostic>[0], WriteDiagnosticOptions>>;
type WriteReturnsPath = Assert<Equal<ReturnType<typeof writeDiagnostic>, Promise<string>>>;

function proveDiagnosticContracts(untrusted: unknown, run: AgentRunResult, diagnostic: Diagnostic): void {
  const normalized = normalizeDiagnosticSchema(untrusted);
  const built = buildDiagnostic({
    run,
    usage: { provider: null, model: null, runMode: null, calls: null, tokensIn: null, tokensOut: null },
    receiptPath: null,
    receiptStatus: undefined,
  });
  const written = writeDiagnostic({ workspaceRoot: ".", diagnostic });
  const validToolName: ToolName | null = normalized.tools[0]?.toolName ?? null;
  const validToolOutcome: DiagnosticToolOutcome | undefined = built.tools[0]?.outcome;

  // @ts-expect-error Diagnostic lifecycle pairs remain correlated.
  const invalidLifecycle: Diagnostic = { ...diagnostic, status: "success", terminalReason: "provider_error" };
  // @ts-expect-error Tool names remain bounded to the canonical vocabulary.
  const invalidToolName: Diagnostic = { ...diagnostic, tools: [{ toolName: "delete", outcome: "unknown" }] };
  // @ts-expect-error Tool outcomes remain bounded to the canonical vocabulary.
  const invalidToolOutcome: Diagnostic = { ...diagnostic, tools: [{ toolName: "read", outcome: "other" }] };
  // @ts-expect-error Arbitrary raw fields are not part of Diagnostic.
  const invalidRawField: Diagnostic = { ...diagnostic, rawProviderBody: "secret" };

  void [normalized, built, written, validToolName, validToolOutcome, invalidLifecycle, invalidToolName, invalidToolOutcome, invalidRawField];
}

type CompileProof = [NormalizeAcceptsUnknown, NormalizeReturnsDiagnostic, BuildAcceptsContract, BuildReturnsDiagnostic, WriteAcceptsContract, WriteReturnsPath];
const compileProof: CompileProof = [true, true, true, true, true, true];
void [compileProof, proveDiagnosticContracts];
