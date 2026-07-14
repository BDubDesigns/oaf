import { parseAgentConfig, runAgentCli, sanitizeTerminal, usageFrom } from "../../lib/agent/cli.ts";
import type {
  AgentCliConfig,
  AgentCliEnvironment,
  AgentCliOptions,
  AgentCliResult,
  AgentCliUsageRun,
  ValidatedReceiptUsage,
} from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type SanitizerSignature = Assert<Equal<typeof sanitizeTerminal, (text: unknown) => string>>;
type ConfigSignature = Assert<Equal<typeof parseAgentConfig, (env?: AgentCliEnvironment) => AgentCliConfig>>;
type UsageSignature = Assert<Equal<typeof usageFrom, (run: AgentCliUsageRun, config: Pick<AgentCliConfig, "model">) => ValidatedReceiptUsage>>;
type CliSignature = Assert<Equal<typeof runAgentCli, (options?: AgentCliOptions) => Promise<AgentCliResult>>>;

if (false) {
  const environment: AgentCliEnvironment = Object.create(null);
  const config: AgentCliConfig = parseAgentConfig(environment);
  const usage: ValidatedReceiptUsage = usageFrom({ turns: 0, providerCalls: [] }, config);
  const sanitized: string = sanitizeTerminal({ toString: () => "response" });
  const result: Promise<AgentCliResult> = runAgentCli();
  // @ts-expect-error CLI config never returns the API-key value.
  config.apiKey;
  // @ts-expect-error CLI options do not create a provider injection seam.
  const providerInjection: AgentCliOptions = { provider: {} };
  // @ts-expect-error Public failures do not expose a completed run.
  const publicFailure: AgentCliResult = { code: 2, message: "Error: agent task is required.", run: {} };
  // @ts-expect-error Completed results do not expose a public message.
  const completedResult: AgentCliResult = { code: 0, run: {}, message: "unexpected" };
  void [usage, sanitized, result, providerInjection, publicFailure, completedResult];
}

const proof: [SanitizerSignature, ConfigSignature, UsageSignature, CliSignature] = [true, true, true, true];
void proof;
process.stdout.write("agent-cli-native-typescript:ok");
