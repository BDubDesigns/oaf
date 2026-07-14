// Minimal OAF-owned agent loop (issue #31).
//
// The smallest useful loop: load context, call a provider through the seam in
// provider.ts, dispatch registered tools via their existing execution
// implementations, emit AgentEvents, and stop on a terminal response or the
// max-turn limit.
//
// Deliberately absent here: provider SDK/network code (the narrowly scoped
// adapter is separate), streaming, context compaction, provider routing, model
// escalation, CLI wiring, and multi-agent behavior. Those are later issues.

import { randomUUID } from "node:crypto";
import { TOOL_NAMES, getToolDefinition } from "./tools.ts";
import { createEvent, createEventCollector } from "./events.ts";
import { loadAgentContext } from "./context.mjs";
import { buildToolProtocol, normalizeProviderAttempt, ProviderFailure, validateProviderCall } from "./provider.ts";
import { summarizeToolCall, summarizeToolResult, utf8Bytes } from "./privacy.mjs";
import { AgentToolError, publicToolError } from "./tool-errors.ts";
import {
  executeRead,
  executeWrite,
  executeList,
  executeGrep,
  executeCommand,
} from "./tool-execution.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentEventType,
  AgentLoopOptions,
  AgentRunResult,
  ProviderMessage,
  Provider,
  ProviderToolResult,
  ToolDefinition,
  ToolArguments,
  ToolExecutorMap,
  ToolExecutorResults,
  ToolName,
} from "./contracts.ts";

// Hard stop so a broken/mock provider can never loop forever.
export const DEFAULT_MAX_TURNS = 8;

export const DEFAULT_EXECUTORS: ToolExecutorMap = {
  read: executeRead,
  list: executeList,
  grep: executeGrep,
  write: executeWrite,
  command: executeCommand,
};

type ToolSuccess = {
  [Name in ToolName]: {
    toolName: Name;
    result: ToolExecutorResults[Name];
  }
}[ToolName];

function buildSystem(context: AgentContext): string {
  return context.documents
    .map((document) => `--- ${document.source}:${document.path} ---\n${document.content}`)
    .join("\n\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesJsonType(value: unknown, type: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && !Number.isNaN(value);
  return false;
}

// `workspaceRoot` is an OAF-reserved argument. The model must never be able to
// supply or replace it: it is stripped from tool args during validation and
// injected only by the loop after validation succeeds.
const RESERVED_ARGS = new Set(["workspaceRoot"]);

// Validate model-supplied tool args against the registered tool's argsSchema.
// No third-party validator: only the primitive types, enum, minimum, required
// fields, and top-level key set used by the current five schemas are checked.
// Unknown keys are rejected; the reserved `workspaceRoot` key is stripped (never
// trusted from the model). Returns a copy with the reserved key removed so it
// can never reach an executor. Throws on any violation (fail closed).
function validateToolArgs(tool: ToolDefinition<ToolName>, args: unknown): Record<string, unknown> {
  if (!isPlainObject(args)) {
    throw new Error(`tool '${tool.name}' requires a non-null object of arguments`);
  }
  const schema = tool.argsSchema ?? { properties: {}, required: [] };
  const properties = schema.properties ?? {};

  for (const key of Object.keys(args)) {
    if (RESERVED_ARGS.has(key)) continue;
    if (!(key in properties)) {
      throw new Error(`tool '${tool.name}' received unexpected argument: ${key}`);
    }
  }

  for (const required of schema.required ?? []) {
    if (!(required in args)) {
      throw new Error(`tool '${tool.name}' is missing required argument: ${required}`);
    }
  }

  const validated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (RESERVED_ARGS.has(key)) continue;
    validated[key] = value;
    if (value === undefined) continue;
    const prop = properties[key];
    if (!matchesJsonType(value, prop.type)) {
      throw new Error(`tool '${tool.name}' argument '${key}' must be type ${prop.type}`);
    }
    if (prop.type === "integer" && typeof prop.minimum === "number" && typeof value === "number" && value < prop.minimum) {
      throw new Error(`tool '${tool.name}' argument '${key}' must be >= ${prop.minimum}`);
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      throw new Error(`tool '${tool.name}' argument '${key}' must be one of: ${prop.enum.join(", ")}`);
    }
  }
  return validated;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`tool argument '${key}' must be a string`);
  return value;
}

function optionalInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`tool argument '${key}' must be an integer`);
  return value;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`tool argument '${key}' must be a boolean`);
  return value;
}

function commandMode(args: Record<string, unknown>): ToolArguments["command"]["mode"] {
  const value = args.mode;
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("tool argument 'mode' must be a sandbox mode");
  switch (value) {
    case "plan":
    case "edit":
    case "test":
    case "browser":
    case "install":
    case "research":
      return value;
    default:
      throw new Error("tool argument 'mode' must be a sandbox mode");
  }
}

function readArguments(args: Record<string, unknown>): ToolArguments["read"] {
  return { path: requiredString(args, "path"), startLine: optionalInteger(args, "startLine"), endLine: optionalInteger(args, "endLine") };
}

function listArguments(args: Record<string, unknown>): ToolArguments["list"] {
  return { path: requiredString(args, "path"), recursive: optionalBoolean(args, "recursive") };
}

function grepArguments(args: Record<string, unknown>): ToolArguments["grep"] {
  const path = args.path === undefined ? undefined : requiredString(args, "path");
  const glob = args.glob === undefined ? undefined : requiredString(args, "glob");
  return { pattern: requiredString(args, "pattern"), path, glob };
}

function writeArguments(args: Record<string, unknown>): ToolArguments["write"] {
  return { path: requiredString(args, "path"), content: requiredString(args, "content") };
}

function commandArguments(args: Record<string, unknown>): ToolArguments["command"] {
  return { command: requiredString(args, "command"), mode: commandMode(args) };
}

function assertUnreachable(value: never): never {
  throw new Error(`unsupported tool: ${value}`);
}

async function executeTool(executors: ToolExecutorMap, toolName: ToolName, args: Record<string, unknown>, workspaceRoot: string): Promise<ToolSuccess> {
  switch (toolName) {
    case "read": {
      const result = await executors.read({ ...readArguments(args), workspaceRoot });
      return { toolName, result };
    }
    case "list": {
      const result = await executors.list({ ...listArguments(args), workspaceRoot });
      return { toolName, result };
    }
    case "grep": {
      const result = await executors.grep({ ...grepArguments(args), workspaceRoot });
      return { toolName, result };
    }
    case "write": {
      const result = await executors.write({ ...writeArguments(args), workspaceRoot });
      return { toolName, result };
    }
    case "command": {
      const result = await executors.command({ ...commandArguments(args), workspaceRoot });
      return { toolName, result };
    }
    default:
      return assertUnreachable(toolName);
  }
}

function recordSuccessfulToolResult(toolCallId: string, success: ToolSuccess): AgentEvent {
  // summarizeToolResult is the established privacy boundary. Its output is
  // validated by createEvent before it can enter durable audit data.
  return Reflect.apply(createEvent, undefined, ["tool_result", {
    toolCallId,
    toolName: success.toolName,
    summary: summarizeToolResult(success.toolName, success.result),
    errorCode: null,
  }]);
}

function createRuntimeEvent(type: AgentEventType, fields: unknown): AgentEvent {
  return Reflect.apply(createEvent, undefined, [type, fields]);
}

function successfulProviderResult(toolCallId: string, success: ToolSuccess): ProviderToolResult {
  switch (success.toolName) {
    case "read": return { toolCallId, toolName: "read", result: success.result };
    case "list": return { toolCallId, toolName: "list", result: success.result };
    case "grep": return { toolCallId, toolName: "grep", result: success.result };
    case "write": return { toolCallId, toolName: "write", result: success.result };
    case "command": return { toolCallId, toolName: "command", result: success.result };
    default: return assertUnreachable(success);
  }
}

// Coerce and validate a provider response into the shape the loop relies on.
// A malformed response fails closed by throwing before any dispatch.
function normalizeResponse(response: unknown, turn: number): { content: string | null; toolCalls: unknown[]; providerCall: unknown } {
  if (!isPlainObject(response)) {
    throw new Error(`provider response must be an object (turn ${turn})`);
  }
  if (response.content !== undefined && response.content !== null && typeof response.content !== "string") {
    throw new Error(`provider response.content must be a string or null (turn ${turn})`);
  }
  const toolCalls = response.toolCalls ?? [];
  if (!Array.isArray(toolCalls)) {
    throw new Error(`provider response.toolCalls must be an array (turn ${turn})`);
  }
  return {
    content: response.content ?? null,
    toolCalls,
    providerCall: response.providerCall ?? null,
  };
}

// Tool-call IDs are the join key between calls and results in events and
// receipts. Keep identity unique for one run, before emitting or dispatching a
// repeated call, so a malformed provider cannot create ambiguous pairing.
function recordUniqueToolCallIds(toolCalls: unknown[], seenIds: Set<string>, turn: number): void {
  const currentIds = new Set<string>();
  for (const call of toolCalls) {
    if (!isPlainObject(call) || typeof call.id !== "string" || call.id.length === 0) continue;
    if (currentIds.has(call.id) || seenIds.has(call.id)) {
      throw new Error(`provider response reuses a tool-call ID (turn ${turn})`);
    }
    currentIds.add(call.id);
  }
  for (const id of currentIds) seenIds.add(id);
}

function isCommandExecutor(value: unknown): value is ToolExecutorMap["command"] {
  return typeof value === "function";
}

function isProvider(value: unknown): value is Provider {
  return isPlainObject(value) && typeof value.complete === "function";
}

type ValidatedLoopOptions = AgentLoopOptions & { maxTurns: number; commandExecutor: ToolExecutorMap["command"] };

function validateLoopOptions(options: unknown): ValidatedLoopOptions {
  if (!isPlainObject(options)) throw new Error("agent loop options must be an object");
  const task = options.task;
  const workspaceRoot = options.workspaceRoot;
  const provider = options.provider;
  const maxTurns = options.maxTurns === undefined ? DEFAULT_MAX_TURNS : options.maxTurns;
  const oafRoot = options.oafRoot;
  const runId = options.runId;
  const commandExecutor = options.commandExecutor === undefined ? executeCommand : options.commandExecutor;
  if (typeof task !== "string" || task.length === 0) {
    throw new Error("task is required");
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new Error("workspaceRoot is required");
  }
  if (!isProvider(provider)) {
    throw new Error("provider with a complete() method is required");
  }
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error("maxTurns must be a positive integer");
  }
  if (oafRoot !== undefined && typeof oafRoot !== "string") throw new Error("oafRoot must be a string");
  if (runId !== undefined && typeof runId !== "string") throw new Error("runId must be a string");
  if (!isCommandExecutor(commandExecutor)) throw new Error("commandExecutor must be a function");
  return { task, workspaceRoot, provider, maxTurns, oafRoot, runId, commandExecutor };
}

export function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  return runAgentLoopImpl(options);
}

async function runAgentLoopImpl(options: unknown): Promise<AgentRunResult> {
  const { task, workspaceRoot, provider, maxTurns, oafRoot, runId, commandExecutor } = validateLoopOptions(options);

  const collector = createEventCollector();
  const run = runId ?? `run_${randomUUID()}`;
  collector.record(createEvent("agent_start", { runId: run, taskBytes: utf8Bytes(task), taskProvided: true }));

  const context = await loadAgentContext({ workspaceRoot, oafRoot });
  const system = buildSystem(context);
  const tools = buildToolProtocol();
  const executors: ToolExecutorMap = { ...DEFAULT_EXECUTORS, command: commandExecutor ?? executeCommand };

  const messages: ProviderMessage[] = [{ role: "user", content: task }];
  let turn = 0;
  let terminalReason: "assistant_terminal" | "max_turns" | null = null;
  let finalContent = null;
  const providerCalls: ({ turn: number } & import("./contracts.ts").ProviderCallMetadata)[] = [];
  const providerAttempts: import("./contracts.ts").ProviderAttempt[] = [];
  const seenToolCallIds = new Set<string>();

  while (turn < maxTurns) {
    turn++;
    collector.record(createEvent("turn_start", { turn }));

    const request = { system, messages, tools };
    collector.record(createEvent("message_start", { turn }));

    let response: unknown;
    let normalized: { content: string | null; toolCalls: unknown[]; providerCall: unknown };
    const startedAt = Date.now();
    try {
      response = await provider.complete(request);
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unknown_provider_error");
      providerAttempts.push(normalizeProviderAttempt({ turn, durationMs: Math.max(0, Date.now() - startedAt), outcome: failure.outcome, httpStatus: failure.httpStatus }, turn));
      collector.record(createEvent("message_end", { turn, disposition: "provider_error", contentPresent: false, contentBytes: 0, toolCallCount: 0, errorCode: "provider_error" }));
      collector.record(createEvent("agent_end", { runId: run, status: "failed", turns: turn, terminalReason: "provider_error" }));
      return {
        runId: run,
        status: "failed",
        turns: turn,
        terminalReason: "provider_error",
        content: null,
        providerCalls,
        providerAttempts,
        context,
        events: collector.all(),
      };
    }
    try {
      normalized = normalizeResponse(response, turn);
      recordUniqueToolCallIds(normalized.toolCalls, seenToolCallIds, turn);
      if (normalized.providerCall !== null) {
        providerCalls.push({ turn, ...validateProviderCall(normalized.providerCall) });
      }
      providerAttempts.push(normalizeProviderAttempt({ turn, durationMs: Math.max(0, Date.now() - startedAt), outcome: "success", httpStatus: null }, turn));
    } catch {
      providerAttempts.push(normalizeProviderAttempt({ turn, durationMs: Math.max(0, Date.now() - startedAt), outcome: "invalid_response", httpStatus: null }, turn));
      collector.record(createEvent("message_end", { turn, disposition: "provider_error", contentPresent: false, contentBytes: 0, toolCallCount: 0, errorCode: "provider_error" }));
      collector.record(createEvent("agent_end", { runId: run, status: "failed", turns: turn, terminalReason: "provider_error" }));
      return {
        runId: run,
        status: "failed",
        turns: turn,
        terminalReason: "provider_error",
        content: null,
        providerCalls,
        providerAttempts,
        context,
        events: collector.all(),
      };
    }
    const requested = normalized.toolCalls;
    collector.record(createRuntimeEvent("message_end", {
      turn,
      disposition: requested.length === 0 ? "terminal" : "tool_calls",
      contentPresent: typeof normalized.content === "string" && normalized.content.length > 0,
      contentBytes: utf8Bytes(normalized.content),
      toolCallCount: requested.length,
      errorCode: null,
    }));
    if (requested.length === 0) {
      finalContent = normalized.content;
      terminalReason = "assistant_terminal";
      break;
    }

    const toolResults: ProviderToolResult[] = [];
    for (let index = 0; index < requested.length; index++) {
      const call = requested[index];
      const callObject = isPlainObject(call) ? call : null;
      const toolName = typeof callObject?.name === "string" ? callObject.name : null;
      const tool = typeof toolName === "string" ? getToolDefinition(toolName) : undefined;
      const auditToolName = tool?.name ?? null;
      const providerId = typeof callObject?.id === "string" && callObject.id.length > 0 ? callObject.id : `call_${turn}_${index + 1}`;
      const auditId = `tool_${turn}_${index + 1}`;

      collector.record(createRuntimeEvent("tool_call", { toolCallId: auditId, toolName: auditToolName, summary: summarizeToolCall(auditToolName, callObject?.args) }));

      // Unknown or malformed tool name: recorded and rejected before any
      // executor runs. No tool_execution_start/end is emitted for this.
      if (!tool) {
        const error = new AgentToolError("INVALID_TOOL_ARGUMENTS");
        collector.record(createEvent("tool_result", { toolCallId: auditId, toolName: auditToolName, summary: {}, errorCode: "rejected" }));
        toolResults.push({ toolCallId: providerId, toolName: toolName ?? null, error: error.message, errorCode: error.code });
        continue;
      }

      // Validate args. A validation failure is a rejection: emit tool_result
      // only, never tool_execution_start/end (no executor was invoked).
      let validated;
      try {
        validated = validateToolArgs(tool, callObject?.args);
      } catch {
        collector.record(createEvent("tool_result", { toolCallId: auditId, toolName: tool.name, summary: {}, errorCode: "rejected" }));
        const publicError = new AgentToolError("INVALID_TOOL_ARGUMENTS");
        toolResults.push({ toolCallId: providerId, toolName: tool.name, error: publicError.message, errorCode: publicError.code });
        continue;
      }

      // Trusted OAF-owned arguments win: the loop injects workspaceRoot only
      // here, after validation, overriding any provider data (which was
      // stripped). The executor-level boundary remains as defense in depth.
      collector.record(createEvent("tool_execution_start", { toolCallId: auditId, toolName: tool.name }));
      let success: ToolSuccess | undefined;
      let executorError;
      try {
        success = await executeTool(executors, tool.name, validated, workspaceRoot);
      } catch (error) {
        executorError = publicToolError(error);
      }

      if (executorError !== undefined) {
        collector.record(createEvent("tool_execution_end", { toolCallId: auditId, toolName: tool.name, success: false }));
        collector.record(createEvent("tool_result", { toolCallId: auditId, toolName: tool.name, summary: {}, errorCode: "execution_error" }));
        toolResults.push({ toolCallId: providerId, toolName: tool.name, error: executorError.message, errorCode: executorError.code });
      } else {
        collector.record(createEvent("tool_execution_end", { toolCallId: auditId, toolName: tool.name, success: true }));
        try {
          if (success === undefined) throw new Error("tool execution completed without a result");
          collector.record(recordSuccessfulToolResult(auditId, success));
        } catch {
          // Event recording failed after the tool succeeded. Record a bounded
          // rejection without losing the successful result or emitting a second
          // execution-end event. The provider still receives the exact result.
          collector.record(createEvent("tool_result", { toolCallId: auditId, toolName: tool.name, summary: {}, errorCode: "rejected" }));
        }
        if (success === undefined) {
          const publicError = new AgentToolError("TOOL_EXECUTION_FAILED");
          toolResults.push({ toolCallId: providerId, toolName: tool.name, error: publicError.message, errorCode: publicError.code });
        } else {
          toolResults.push(successfulProviderResult(providerId, success));
        }
      }
    }

    messages.push({ role: "assistant", content: normalized.content, toolCalls: requested });
    messages.push({ role: "tool", toolResults });
  }

  if (terminalReason === null) {
    // The loop left the while guard because maxTurns was reached.
    terminalReason = "max_turns";
  }

  if (terminalReason === "max_turns") {
    collector.record(createEvent("agent_end", { runId: run, status: "exhausted", turns: turn, terminalReason }));
    return { runId: run, status: "exhausted", turns: turn, terminalReason, content: null, providerCalls, providerAttempts, context, events: collector.all() };
  }
  collector.record(createEvent("agent_end", { runId: run, status: "success", turns: turn, terminalReason: "assistant_terminal" }));
  return { runId: run, status: "success", turns: turn, terminalReason: "assistant_terminal", content: finalContent, providerCalls, providerAttempts, context, events: collector.all() };
}
