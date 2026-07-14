import {
  type AgentLoopWithReceiptOptions,
  type AgentRunResult,
  type AgentRunWithReceiptResult,
  type BuildReceiptOptions,
  type Receipt,
  type ReceiptUsage,
  type ValidatedReceiptUsage,
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
type ValidateReturnsUsage = Assert<Equal<ReturnType<typeof validateReceiptUsage>, ValidatedReceiptUsage>>;
type BuildAcceptsOptions = Assert<Equal<Parameters<typeof buildReceipt>[0], BuildReceiptOptions>>;
type BuildReturnsReceipt = Assert<Equal<ReturnType<typeof buildReceipt>, Receipt>>;
type FileNameAcceptsReceipt = Assert<Equal<Parameters<typeof receiptFileName>[0], Receipt>>;
type FileNameReturnsString = Assert<Equal<ReturnType<typeof receiptFileName>, string>>;
type WriteAcceptsOptions = Assert<Equal<Parameters<typeof writeReceipt>[0], WriteReceiptOptions>>;
type WriteReturnsPath = Assert<Equal<ReturnType<typeof writeReceipt>, Promise<string>>>;
type LoopAcceptsOptions = Assert<Equal<Parameters<typeof runAgentLoopWithReceipt>[0], AgentLoopWithReceiptOptions>>;
type LoopReturnsResult = Assert<Equal<ReturnType<typeof runAgentLoopWithReceipt>, Promise<AgentRunWithReceiptResult>>>;

function proveReceiptContracts(untrusted: unknown, options: BuildReceiptOptions, receipt: Receipt, writeOptions: WriteReceiptOptions, loopOptions: AgentLoopWithReceiptOptions, successfulRun: Extract<AgentRunResult, { status: "success" }>, exhaustedRun: Extract<AgentRunResult, { status: "exhausted" }>, providerFailedRun: Extract<AgentRunResult, { status: "failed" }>, successReceipt: Extract<Receipt, { status: "success" }>, partialReceipt: Extract<Receipt, { status: "partial" }>, maxTurnsReceipt: Extract<Receipt, { terminalReason: "max_turns" }>, providerErrorReceipt: Extract<Receipt, { terminalReason: "provider_error" }>): void {
  const usage = validateReceiptUsage(untrusted);
  const built = buildReceipt(options);
  const fileName = receiptFileName(receipt);
  const written = writeReceipt(writeOptions);
  const loop = runAgentLoopWithReceipt(loopOptions);
  const commandStatus: "pass" | "fail" | "error" | undefined = built.commands[0]?.status;
  const checkStatus: "pass" | "fail" | "error" | undefined = built.checks[0]?.status;
  const runMode: "agent" = usage.runMode;
  const validatedUsage: ValidatedReceiptUsage = usage;
  const storedValidatedUsage: ReceiptUsage = validatedUsage;
  const defaultUsage: ReceiptUsage = { provider: null, model: null, runMode: null, calls: null, tokensIn: null, tokensOut: null };
  const successfulWithSuccess: AgentRunWithReceiptResult = { ...successfulRun, receipt: successReceipt, receiptPath: "oaf/receipts/success.json", events: successfulRun.events };
  const successfulWithPartial: AgentRunWithReceiptResult = { ...successfulRun, receipt: partialReceipt, receiptPath: "oaf/receipts/partial.json", events: successfulRun.events };

  // @ts-expect-error A provider-failed run cannot produce a success receipt.
  const providerFailedSuccess: AgentRunWithReceiptResult = { ...providerFailedRun, receipt: successReceipt, receiptPath: "oaf/receipts/invalid.json", events: providerFailedRun.events };
  // @ts-expect-error A provider-failed run cannot produce a partial receipt.
  const providerFailedPartial: AgentRunWithReceiptResult = { ...providerFailedRun, receipt: partialReceipt, receiptPath: "oaf/receipts/invalid.json", events: providerFailedRun.events };
  // @ts-expect-error An exhausted run cannot produce a success receipt.
  const exhaustedSuccess: AgentRunWithReceiptResult = { ...exhaustedRun, receipt: successReceipt, receiptPath: "oaf/receipts/invalid.json", events: exhaustedRun.events };
  // @ts-expect-error An exhausted run cannot produce a partial receipt.
  const exhaustedPartial: AgentRunWithReceiptResult = { ...exhaustedRun, receipt: partialReceipt, receiptPath: "oaf/receipts/invalid.json", events: exhaustedRun.events };
  // @ts-expect-error A provider-failed run cannot produce a max-turns receipt.
  const providerFailedMaxTurns: AgentRunWithReceiptResult = { ...providerFailedRun, receipt: maxTurnsReceipt, receiptPath: "oaf/receipts/invalid.json", events: providerFailedRun.events };
  // @ts-expect-error An exhausted run cannot produce a provider-error receipt.
  const exhaustedProviderError: AgentRunWithReceiptResult = { ...exhaustedRun, receipt: providerErrorReceipt, receiptPath: "oaf/receipts/invalid.json", events: exhaustedRun.events };
  // @ts-expect-error Explicit receipt usage requires a provider identifier.
  const nullUsageProvider: ValidatedReceiptUsage = { ...validatedUsage, provider: null };
  // @ts-expect-error Explicit receipt usage requires a model identifier.
  const nullUsageModel: ValidatedReceiptUsage = { ...validatedUsage, model: null };
  // @ts-expect-error Explicit receipt usage requires agent run mode.
  const nullUsageRunMode: ValidatedReceiptUsage = { ...validatedUsage, runMode: null };
  // @ts-expect-error Explicit receipt usage requires a call count.
  const nullUsageCalls: ValidatedReceiptUsage = { ...validatedUsage, calls: null };
  // @ts-expect-error Arbitrary provider payloads are not serialized receipt fields.
  const rawProviderBody: Receipt = { ...receipt, providerBody: "secret" };
  // @ts-expect-error Raw model output is not serialized in a receipt.
  const rawModelContent: Receipt = { ...receipt, modelContent: "secret" };
  // @ts-expect-error Raw exception data is not serialized in a receipt.
  const rawException: Receipt = { ...receipt, cause: new Error("secret") };
  // @ts-expect-error Raw tool output is not serialized in a receipt.
  const rawToolOutput: Receipt = { ...receipt, toolOutput: "secret" };

  void [usage, built, fileName, written, loop, commandStatus, checkStatus, runMode, storedValidatedUsage, defaultUsage, successfulWithSuccess, successfulWithPartial, providerFailedSuccess, providerFailedPartial, exhaustedSuccess, exhaustedPartial, providerFailedMaxTurns, exhaustedProviderError, nullUsageProvider, nullUsageModel, nullUsageRunMode, nullUsageCalls, rawProviderBody, rawModelContent, rawException, rawToolOutput];
}

type CompileProof = [ValidateAcceptsUnknown, ValidateReturnsUsage, BuildAcceptsOptions, BuildReturnsReceipt, FileNameAcceptsReceipt, FileNameReturnsString, WriteAcceptsOptions, WriteReturnsPath, LoopAcceptsOptions, LoopReturnsResult];
const compileProof: CompileProof = [true, true, true, true, true, true, true, true, true, true];
void [compileProof, proveReceiptContracts];
