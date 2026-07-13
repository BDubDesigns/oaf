import {
  AGENT_EVENT_TYPES,
  COMMAND_ORIGINS,
  PROVIDER_ATTEMPT_OUTCOMES,
  PROVIDER_FAILURE_OUTCOMES,
  RUN_TERMINALS,
  TOOL_NAMES,
  type AgentAuthorization,
  type AgentEvent,
  type CommandOrigin,
  type ProviderAttempt,
  type ProviderFailureOutcome,
  type ProviderAttemptOutcome,
  type ToolName,
} from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type AllToolsHaveDefinitions = Assert<Equal<ToolName, (typeof TOOL_NAMES)[number]>>;
type FailureIsNotSuccess = Assert<Equal<Extract<ProviderFailureOutcome, "success">, never>>;
type AttemptIncludesFailure = Assert<Equal<Exclude<ProviderFailureOutcome, ProviderAttemptOutcome>, never>>;
type AgentCannotGrantHumanCapabilities = Assert<Equal<keyof AgentAuthorization, "origin" | "approvalGranted" | "networkGranted">>;

function assertNever(value: never): never { throw new Error(`Unhandled contract value: ${String(value)}`); }

function providerOutcomeLabel(outcome: ProviderAttemptOutcome): string {
  switch (outcome) {
    case "success": return "success";
    case "authentication_failed": return "authentication_failed";
    case "not_found": return "not_found";
    case "rate_limited": return "rate_limited";
    case "http_error": return "http_error";
    case "timeout": return "timeout";
    case "network_error": return "network_error";
    case "invalid_json": return "invalid_json";
    case "response_too_large": return "response_too_large";
    case "invalid_response": return "invalid_response";
    case "unknown_provider_error": return "unknown_provider_error";
    default: return assertNever(outcome);
  }
}

function terminalLabel(terminal: (typeof RUN_TERMINALS)[number]): string {
  switch (terminal.status) {
    case "success": return terminal.terminalReason;
    case "exhausted": return terminal.terminalReason;
    case "failed": return terminal.terminalReason;
    default: return assertNever(terminal);
  }
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "agent_start": return event.runId;
    case "turn_start": return String(event.turn);
    case "message_start": return String(event.turn);
    case "message_end": return event.disposition;
    case "tool_call": return event.toolCallId;
    case "tool_execution_start": return event.toolCallId;
    case "tool_execution_end": return event.toolCallId;
    case "tool_result": return event.toolCallId;
    case "receipt_emitted": return event.receiptId;
    case "agent_end": return event.status;
    default: return assertNever(event);
  }
}

function commandOriginLabel(origin: CommandOrigin): string {
  switch (origin) {
    case "agent": return "agent";
    case "human_cli": return "human_cli";
    default: return assertNever(origin);
  }
}

const httpFailure: ProviderAttempt = { turn: 1, durationMs: 1, outcome: "http_error", httpStatus: 500 };
const localFailure: ProviderAttempt = { turn: 1, durationMs: 1, outcome: "timeout", httpStatus: null };
const successfulAttempt: ProviderAttempt = { turn: 1, durationMs: 1, outcome: "success", httpStatus: null };

void [AGENT_EVENT_TYPES, COMMAND_ORIGINS, PROVIDER_ATTEMPT_OUTCOMES, PROVIDER_FAILURE_OUTCOMES, TOOL_NAMES, providerOutcomeLabel, terminalLabel, eventLabel, commandOriginLabel, httpFailure, localFailure, successfulAttempt];
