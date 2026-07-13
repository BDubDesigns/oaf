// Closed OAF agent vocabulary shared by runtime validators and TypeScript.
// Conversation payloads intentionally do not appear in durable audit types.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }
export interface JsonSchema { type: string | readonly string[]; description?: string; enum?: readonly string[]; minimum?: number; properties?: Readonly<Record<string, JsonSchema>>; required?: readonly string[]; items?: JsonSchema; }
export interface ObjectJsonSchema extends JsonSchema { type: "object"; properties: Readonly<Record<string, JsonSchema>>; required: readonly string[]; }

export const PROVIDER_FAILURE_OUTCOMES = ["authentication_failed", "not_found", "rate_limited", "http_error", "timeout", "network_error", "invalid_json", "response_too_large", "invalid_response", "unknown_provider_error"] as const;
export type ProviderFailureOutcome = (typeof PROVIDER_FAILURE_OUTCOMES)[number];
export const PROVIDER_ATTEMPT_OUTCOMES = ["success", ...PROVIDER_FAILURE_OUTCOMES] as const;
export type ProviderAttemptOutcome = (typeof PROVIDER_ATTEMPT_OUTCOMES)[number];
export const HTTP_PROVIDER_FAILURE_OUTCOMES = ["authentication_failed", "not_found", "rate_limited", "http_error"] as const;
export type HttpProviderFailureOutcome = (typeof HTTP_PROVIDER_FAILURE_OUTCOMES)[number];
export const NON_HTTP_PROVIDER_FAILURE_OUTCOMES = ["timeout", "network_error", "invalid_json", "response_too_large", "invalid_response", "unknown_provider_error"] as const;
export type NonHttpProviderFailureOutcome = (typeof NON_HTTP_PROVIDER_FAILURE_OUTCOMES)[number];

export type ProviderIdentifier = string;
export type ModelIdentifier = string;
export interface ProviderUsage { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; }
export interface ProviderCallMetadata { provider: ProviderIdentifier; requestedModel: ModelIdentifier; reportedModel: ModelIdentifier | null; usage: ProviderUsage; }
export type ProviderAttempt =
  | { turn: number; durationMs: number; outcome: "success"; httpStatus: null }
  | { turn: number; durationMs: number; outcome: HttpProviderFailureOutcome; httpStatus: number }
  | { turn: number; durationMs: number; outcome: NonHttpProviderFailureOutcome; httpStatus: null };
export interface NormalizedProviderToolCall { id: string; name: string; args: JsonObject; }
export type ProviderToolResult = {
  [Name in ToolName]: { toolCallId: string; toolName: Name; result: ToolExecutorResults[Name] }
}[ToolName] | { toolCallId: string; toolName: string | null; error: string; errorCode: ToolErrorCode };
export type ProviderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: NormalizedProviderToolCall[] }
  | { role: "tool"; toolResults: ProviderToolResult[] };
export interface ProviderToolDefinition { name: ToolName; description: string; argsSchema: ObjectJsonSchema; }
export interface NormalizedProviderRequest { system: string; messages: ProviderMessage[]; tools: ProviderToolDefinition[]; }
export interface NormalizedProviderResponse { content: string | null; toolCalls: NormalizedProviderToolCall[]; providerCall?: ProviderCallMetadata; }
export interface Provider { complete(request: NormalizedProviderRequest): Promise<NormalizedProviderResponse>; }
export type MockProviderScript = readonly unknown[] | ((request: NormalizedProviderRequest, callCount: number) => unknown | Promise<unknown>);
export interface MockProvider { readonly callCount: number; readonly remaining: number; complete(request: NormalizedProviderRequest): Promise<unknown>; }

export const TOOL_NAMES = ["read", "list", "grep", "write", "command"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const SANDBOX_MODES = ["plan", "edit", "test", "browser", "install", "research"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];
export type ToolArguments = {
  read: { path: string; startLine?: number; endLine?: number };
  list: { path: string; recursive?: boolean };
  grep: { pattern: string; path?: string; glob?: string };
  write: { path: string; content: string };
  command: { command: string; mode?: SandboxMode };
};
export type ToolExecutorResults = {
  read: { path: string; content: string; truncated: boolean };
  list: { path: string; entries: { name: string; type: string }[] };
  grep: { matches: { path: string; line: number; text: string }[] };
  write: { path: string; bytes: number };
  command: { exitCode: number | null; stdout: string; stderr: string; truncated: boolean };
};
export type ToolExecutorInput<Name extends ToolName> = ToolArguments[Name] & { workspaceRoot: string };
export type ToolExecutorMap = { [Name in ToolName]: (input: ToolExecutorInput<Name>) => Promise<ToolExecutorResults[Name]> };
export type ToolCallSummary = {
  read: { path?: string };
  list: { path?: string; recursive: boolean };
  grep: { path?: string };
  write: { path?: string; bytes: number | null };
  command: { command: string; redacted: boolean; mode: SandboxMode | null };
};
export type ToolResultSummary = {
  read: { path?: string; bytes: number; truncated: boolean };
  list: { path?: string; entryCount: number };
  grep: { matchCount: number; fileCount: number };
  write: { path?: string; bytes: number };
  command: { exitCode: number; stdoutBytes: number; stderrBytes: number; truncated: boolean };
};
export type ToolDefinition<Name extends ToolName> = { name: Name; description: string; kind: "read" | "write" | "command"; mutates: boolean; requiresSandbox: boolean; filesystem: "read" | "write"; argsSchema: ObjectJsonSchema; resultSchema: ObjectJsonSchema; emits: readonly ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"]; };
export type ToolRegistry = Readonly<{ [Name in ToolName]: ToolDefinition<Name> }>;

export const TOOL_ERROR_MESSAGES = { AGENT_PATH_DENIED: "requested project path is not available to the agent", PATH_NOT_FOUND: "requested path does not exist", NOT_A_FILE: "requested path is not a file", NOT_A_DIRECTORY: "requested path is not a directory", INVALID_LINE_RANGE: "requested line range is invalid", INVALID_TOOL_ARGUMENTS: "tool arguments are invalid", PATH_OUTSIDE_WORKSPACE: "requested path is outside the workspace", TOOL_EXECUTION_FAILED: "tool execution failed" } as const;
export type ToolErrorCode = keyof typeof TOOL_ERROR_MESSAGES;
export type PublicToolError = {
  [Code in ToolErrorCode]: { code: Code; message: (typeof TOOL_ERROR_MESSAGES)[Code] }
}[ToolErrorCode];

export const AGENT_EVENT_TYPES = ["agent_start", "turn_start", "message_start", "message_end", "tool_call", "tool_execution_start", "tool_execution_end", "tool_result", "receipt_emitted", "agent_end"] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
export const EVENT_DISPOSITIONS = ["terminal", "tool_calls", "provider_error"] as const;
export type EventDisposition = (typeof EVENT_DISPOSITIONS)[number];
export const EVENT_ERROR_CODES = ["provider_error", "rejected", "execution_error"] as const;
export type EventErrorCode = (typeof EVENT_ERROR_CODES)[number];
export const RUN_TERMINALS = [{ status: "success", terminalReason: "assistant_terminal" }, { status: "exhausted", terminalReason: "max_turns" }, { status: "failed", terminalReason: "provider_error" }] as const;
export type RunStatus = (typeof RUN_TERMINALS)[number]["status"];
export type TerminalReason = (typeof RUN_TERMINALS)[number]["terminalReason"];
export type RunTerminal = (typeof RUN_TERMINALS)[number];
export type AgentEvent =
  | { type: "agent_start"; runId: string; taskBytes: number; taskProvided: boolean }
  | { type: "turn_start" | "message_start"; turn: number }
  | { type: "message_end"; turn: number; disposition: "terminal"; contentPresent: boolean; contentBytes: number; toolCallCount: 0; errorCode: null }
  | { type: "message_end"; turn: number; disposition: "tool_calls"; contentPresent: boolean; contentBytes: number; toolCallCount: number; errorCode: null }
  | { type: "message_end"; turn: number; disposition: "provider_error"; contentPresent: false; contentBytes: 0; toolCallCount: 0; errorCode: "provider_error" }
  | { type: "tool_call"; toolCallId: string; toolName: "read"; summary: ToolCallSummary["read"] }
  | { type: "tool_call"; toolCallId: string; toolName: "list"; summary: ToolCallSummary["list"] }
  | { type: "tool_call"; toolCallId: string; toolName: "grep"; summary: ToolCallSummary["grep"] }
  | { type: "tool_call"; toolCallId: string; toolName: "write"; summary: ToolCallSummary["write"] }
  | { type: "tool_call"; toolCallId: string; toolName: "command"; summary: ToolCallSummary["command"] }
  | { type: "tool_call"; toolCallId: string; toolName: null; summary: {} }
  | { type: "tool_execution_start"; toolCallId: string; toolName: ToolName }
  | { type: "tool_execution_end"; toolCallId: string; toolName: ToolName; success: boolean }
  | { type: "tool_result"; toolCallId: string; toolName: "read"; summary: ToolResultSummary["read"]; errorCode: null }
  | { type: "tool_result"; toolCallId: string; toolName: "list"; summary: ToolResultSummary["list"]; errorCode: null }
  | { type: "tool_result"; toolCallId: string; toolName: "grep"; summary: ToolResultSummary["grep"]; errorCode: null }
  | { type: "tool_result"; toolCallId: string; toolName: "write"; summary: ToolResultSummary["write"]; errorCode: null }
  | { type: "tool_result"; toolCallId: string; toolName: "command"; summary: ToolResultSummary["command"]; errorCode: null }
  | { type: "tool_result"; toolCallId: string; toolName: ToolName | null; summary: {}; errorCode: "rejected" | "execution_error" }
  | { type: "receipt_emitted"; runId: string; receiptId: string; path: string }
  | ({ type: "agent_end"; runId: string; turns: number } & RunTerminal);
export type RecordedAgentEvent = AgentEvent & { seq: number; ts: string };
export type AgentEventFields<Type extends AgentEventType> = Omit<Extract<AgentEvent, { type: Type }>, "type">;
export interface EventCollector { record(event: AgentEvent): RecordedAgentEvent; all(): RecordedAgentEvent[]; clear(): void; }
export interface AgentContext { documents: { source: string; path: string; content: string }[]; docsPack?: { id?: string; oafStack?: string }; }
export type AgentRunResultDetails = { runId: string; turns: number; providerCalls: ({ turn: number } & ProviderCallMetadata)[]; providerAttempts: ProviderAttempt[]; context: AgentContext; events: RecordedAgentEvent[] };
export type AgentRunResult =
  | (AgentRunResultDetails & { status: "success"; terminalReason: "assistant_terminal"; content: string | null })
  | (AgentRunResultDetails & { status: "exhausted"; terminalReason: "max_turns"; content: null })
  | (AgentRunResultDetails & { status: "failed"; terminalReason: "provider_error"; content: null });

export const RECEIPT_STATUSES = ["success", "partial", "failed"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export type ReceiptTerminal = { status: "success" | "partial"; terminalReason: "assistant_terminal" } | { status: "failed"; terminalReason: "provider_error" | "max_turns" };
export interface ReceiptUsage { model: string | null; provider: string | null; runMode: "agent" | null; calls: number | null; tokensIn: number | null; tokensOut: number | null; }
export interface ReceiptCommand { command: string; redacted: boolean; mode: SandboxMode | null; exitCode: number | null; status: "pass" | "fail" | "error"; }
export interface ReceiptCheck { name: string; type: string; status: "pass" | "fail" | "error"; exitCode: number | null; }
export type Receipt = ReceiptTerminal & { schemaVersion: "0.1.0"; id: string; createdAt: string; oafVersion: string | null; app: { name: string | null; oafStack: string | null; docsPack: string | null }; task: { summary: string; redacted: boolean }; runId: string; outcome: string; turns: number; eventSummary: { byType: Record<AgentEventType, number | undefined> }; files: { created: string[]; touched: string[] }; commands: ReceiptCommand[]; checks: ReceiptCheck[]; warnings: string[]; assumptions: string[]; usage: ReceiptUsage; humanReview: { required: true; status: "pending"; reviewer: null; approvedAt: null }; nextSteps: string[]; };
export interface BuildReceiptOptions { run: AgentRunResult; task: string; oafVersion?: string | null; }

export const DIAGNOSTIC_TOOL_OUTCOMES = ["success", "rejected", "execution_error", "unknown"] as const;
export type DiagnosticToolOutcome = (typeof DIAGNOSTIC_TOOL_OUTCOMES)[number];
export const DIAGNOSTIC_STATUSES = ["success", "partial", "failed", "exhausted"] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];
export const DIAGNOSTIC_PROVIDER_IDENTIFIERS = ["openai-compatible"] as const;
export type DiagnosticProviderIdentifier = (typeof DIAGNOSTIC_PROVIDER_IDENTIFIERS)[number];
export interface Diagnostic { schemaVersion: "0.1.0"; createdAt: string; runId: string; provider: DiagnosticProviderIdentifier | null; requestedModel: string | null; status: DiagnosticStatus; terminalReason: TerminalReason; turns: number; receiptPath: string | null; providerAttempts: ProviderAttempt[]; tools: { toolName: ToolName | null; outcome: DiagnosticToolOutcome }[]; }
export interface BuildDiagnosticOptions { run: AgentRunResult; usage: ReceiptUsage | undefined; receiptPath: string | null; receiptStatus: ReceiptStatus | undefined; }

export const COMMAND_ORIGINS = ["agent", "human_cli"] as const;
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number];
export const COMMAND_POLICY_LEVELS = ["allow", "confirm", "block"] as const;
export type CommandPolicyLevel = (typeof COMMAND_POLICY_LEVELS)[number];
export interface CommandClassification { level: CommandPolicyLevel; network: boolean; reason: string; }
export interface AgentAuthorization { origin: "agent"; approvalGranted: false; networkGranted: false; }
export interface HumanCliAuthorization { origin: "human_cli"; approvalGranted: boolean; networkGranted: boolean; }
export type CommandAuthorization = AgentAuthorization | HumanCliAuthorization;
export interface PackageScriptVerification { script: string; command: string; definition: string; }
export interface SandboxExecutionResult { exitCode: number; stdout: string; stderr: string; truncated: boolean; }
export interface ContainerStartRecord { command: string; network: boolean; runtime: string; cwd: string; }
export interface SandboxExecutionCallbacks { onStart?: (record: ContainerStartRecord) => void; onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void; }
export interface VerificationWorkspace { directory: string; nodeModulesMount: string | null; cleanup(): Promise<void>; }
export interface SandboxDependencies { detectRuntime?: () => string | null; createVerificationWorkspace?: (workspaceRoot: string) => Promise<VerificationWorkspace>; runContainer?: (options: ContainerStartRecord & SandboxExecutionCallbacks & { argv: string[] }) => Promise<SandboxExecutionResult>; }
export interface AgentSandboxCommandOptions extends SandboxExecutionCallbacks { command?: string; mode?: SandboxMode; cwd?: string; dependencies?: SandboxDependencies; }
export interface HumanSandboxCommandOptions extends AgentSandboxCommandOptions { approvalGranted?: boolean; networkGranted?: boolean; }
