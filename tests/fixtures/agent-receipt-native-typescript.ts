import {
  type AgentLoopWithReceiptOptions,
  type AgentRunResult,
  type AgentRunWithReceiptResult,
  type BuildReceiptOptions,
  type Receipt,
  type ReceiptUsage,
  type WriteReceiptOptions,
} from "../../lib/agent/contracts.ts";
import {
  buildReceipt,
  receiptFileName,
  runAgentLoopWithReceipt,
  validateReceiptUsage,
  writeReceipt,
} from "../../lib/agent/receipt.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type ValidateAcceptsUnknown = Assert<Equal<Parameters<typeof validateReceiptUsage>[0], unknown>>;
type ValidateReturnsUsage = Assert<Equal<ReturnType<typeof validateReceiptUsage>, ReceiptUsage>>;
type BuildAcceptsOptions = Assert<Equal<Parameters<typeof buildReceipt>[0], BuildReceiptOptions>>;
type BuildReturnsReceipt = Assert<Equal<ReturnType<typeof buildReceipt>, Receipt>>;
type FileNameAcceptsReceipt = Assert<Equal<Parameters<typeof receiptFileName>[0], Receipt>>;
type FileNameReturnsString = Assert<Equal<ReturnType<typeof receiptFileName>, string>>;
type WriteAcceptsOptions = Assert<Equal<Parameters<typeof writeReceipt>[0], WriteReceiptOptions>>;
type WriteReturnsPath = Assert<Equal<ReturnType<typeof writeReceipt>, Promise<string>>>;
type LoopAcceptsOptions = Assert<Equal<Parameters<typeof runAgentLoopWithReceipt>[0], AgentLoopWithReceiptOptions>>;
type LoopReturnsResult = Assert<Equal<ReturnType<typeof runAgentLoopWithReceipt>, Promise<AgentRunWithReceiptResult>>>;

function proveReceiptContracts(untrusted: unknown, options: BuildReceiptOptions, receipt: Receipt, writeOptions: WriteReceiptOptions, loopOptions: AgentLoopWithReceiptOptions, run: AgentRunResult): void {
  const usage = validateReceiptUsage(untrusted);
  const built = buildReceipt(options);
  const fileName = receiptFileName(receipt);
  const written = writeReceipt(writeOptions);
  const loop = runAgentLoopWithReceipt(loopOptions);
  const commandStatus: "pass" | "fail" | "error" | undefined = built.commands[0]?.status;
  const checkStatus: "pass" | "fail" | "error" | undefined = built.checks[0]?.status;
  const runMode: "agent" | null = usage.runMode;

  // @ts-expect-error Receipt terminal status and reason stay correlated.
  const invalidSuccess: Receipt = { ...receipt, status: "success", terminalReason: "provider_error" };
  // @ts-expect-error A failed receipt cannot report successful terminal status.
  const invalidProviderFailure: Receipt = { ...receipt, status: "success", terminalReason: "provider_error" };
  // @ts-expect-error An exhausted receipt cannot report successful terminal status.
  const invalidMaxTurns: Receipt = { ...receipt, status: "success", terminalReason: "max_turns" };
  // @ts-expect-error Arbitrary provider payloads are not serialized receipt fields.
  const rawProviderBody: Receipt = { ...receipt, providerBody: "secret" };
  // @ts-expect-error Raw model output is not serialized in a receipt.
  const rawModelContent: Receipt = { ...receipt, modelContent: "secret" };
  // @ts-expect-error Raw exception data is not serialized in a receipt.
  const rawException: Receipt = { ...receipt, cause: new Error("secret") };
  // @ts-expect-error Raw tool output is not serialized in a receipt.
  const rawToolOutput: Receipt = { ...receipt, toolOutput: "secret" };

  void [usage, built, fileName, written, loop, commandStatus, checkStatus, runMode, invalidSuccess, invalidProviderFailure, invalidMaxTurns, rawProviderBody, rawModelContent, rawException, rawToolOutput];
}

type CompileProof = [ValidateAcceptsUnknown, ValidateReturnsUsage, BuildAcceptsOptions, BuildReturnsReceipt, FileNameAcceptsReceipt, FileNameReturnsString, WriteAcceptsOptions, WriteReturnsPath, LoopAcceptsOptions, LoopReturnsResult];
const compileProof: CompileProof = [true, true, true, true, true, true, true, true, true, true];
void [compileProof, proveReceiptContracts];
