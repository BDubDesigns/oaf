import { parseAgentConfig, runAgentCli, sanitizeTerminal, usageFrom } from "../../lib/agent/cli.ts";
import type {
  AgentCliConfig,
  AgentCliEnvironment,
  AgentCliCompletedResult,
  AgentCliOptions,
  AgentCliOutput,
  AgentCliPublicError,
  AgentCliResult,
  AgentCliUsageRun,
  AgentRunWithReceiptResult,
  ValidatedReceiptUsage,
} from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type SanitizerSignature = Assert<Equal<typeof sanitizeTerminal, (text: unknown) => string>>;
type ConfigSignature = Assert<Equal<typeof parseAgentConfig, (env?: AgentCliEnvironment) => AgentCliConfig>>;
type UsageSignature = Assert<Equal<typeof usageFrom, (run: AgentCliUsageRun, config: Pick<AgentCliConfig, "model">) => ValidatedReceiptUsage>>;
type CliSignature = Assert<Equal<typeof runAgentCli, (options?: AgentCliOptions) => Promise<AgentCliResult>>>;
type ConfigKeys = Assert<Equal<keyof AgentCliConfig, "baseUrl" | "model" | "apiKeyEnv" | "maxTurns">>;
type PublicCodes = Assert<Equal<AgentCliPublicError["code"], 1 | 2>>;
type CompletedCodes = Assert<Equal<AgentCliCompletedResult["code"], 0 | 1 | 3>>;

declare const completedRun: AgentRunWithReceiptResult;

if (false) {
  const environment: AgentCliEnvironment = Object.create(null);
  const config: AgentCliConfig = parseAgentConfig(environment);
  const outputWithLog: AgentCliOutput = { log() {} };
  const outputWithError: AgentCliOutput = { log() {}, error() {} };
  const usage: ValidatedReceiptUsage = usageFrom({ turns: 0, providerCalls: [] }, config);
  const sanitized: string = sanitizeTerminal({ toString: () => "response" });
  const result: Promise<AgentCliResult> = runAgentCli();
  // @ts-expect-error CLI config never returns the API-key value.
  config.apiKey;
  // @ts-expect-error CLI config never returns its environment object.
  config.env;
  // @ts-expect-error CLI config never returns a provider instance.
  config.provider;
  // @ts-expect-error CLI config never returns transport configuration.
  config.transport;
  // @ts-expect-error CLI config never returns an output object.
  config.output;
  // @ts-expect-error Outputs require a log function.
  const outputWithoutLog: AgentCliOutput = { error() {} };
  // @ts-expect-error Output log must be callable.
  const outputWithInvalidLog: AgentCliOutput = { log: "log" };
  // @ts-expect-error Environment values must be strings or undefined.
  const numericEnvironment: AgentCliEnvironment = { OAF_MODEL: 1 };
  // @ts-expect-error Task parts must be strings.
  const numericTaskParts: AgentCliOptions = { taskParts: [1] };
  // @ts-expect-error cwd must be a string.
  const numericCwd: AgentCliOptions = { cwd: 1 };
  // @ts-expect-error oafRoot must be a string.
  const numericOafRoot: AgentCliOptions = { oafRoot: 1 };
  // @ts-expect-error Unrelated options are rejected.
  const unrelatedOption: AgentCliOptions = { unrelated: true };
  // @ts-expect-error CLI options do not create a provider injection seam.
  const providerInjection: AgentCliOptions = { provider: {} };
  // @ts-expect-error CLI options do not create a transport injection seam.
  const transportInjection: AgentCliOptions = { transport: () => {} };
  // @ts-expect-error CLI options do not create an agent-loop injection seam.
  const loopInjection: AgentCliOptions = { loop: () => {} };
  // @ts-expect-error CLI options do not create a receipt-writer injection seam.
  const receiptWriterInjection: AgentCliOptions = { receiptWriter: () => {} };
  // @ts-expect-error CLI options do not create a diagnostic-writer injection seam.
  const diagnosticWriterInjection: AgentCliOptions = { diagnosticWriter: () => {} };
  // @ts-expect-error Public failures do not expose a completed run.
  const publicFailure: AgentCliResult = { code: 2, message: "Error: agent task is required.", run: completedRun };
  // @ts-expect-error Completed results do not expose a public message.
  const completedResult: AgentCliResult = { code: 0, run: completedRun, message: "unexpected" };
  // @ts-expect-error Completed results cannot use the public preflight code.
  const completedPreflightCode: AgentCliCompletedResult = { code: 2, run: completedRun };
  // @ts-expect-error Public failures cannot use the completed max-turn code.
  const publicMaxTurnsCode: AgentCliPublicError = { code: 3, message: "Error: agent task is required." };
  void [outputWithLog, outputWithError, usage, sanitized, result, outputWithoutLog, outputWithInvalidLog, numericEnvironment, numericTaskParts, numericCwd, numericOafRoot, unrelatedOption, providerInjection, transportInjection, loopInjection, receiptWriterInjection, diagnosticWriterInjection, publicFailure, completedResult, completedPreflightCode, publicMaxTurnsCode];
}

const proof: [SanitizerSignature, ConfigSignature, UsageSignature, CliSignature, ConfigKeys, PublicCodes, CompletedCodes] = [true, true, true, true, true, true, true];
void proof;
process.stdout.write("agent-cli-native-typescript:ok");
