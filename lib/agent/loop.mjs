// Minimal OAF-owned agent loop (issue #31).
//
// The smallest useful loop: load context, call a provider through the seam in
// provider.mjs, dispatch registered tools via their existing execution
// implementations, emit AgentEvents, and stop on a terminal response or the
// max-turn limit.
//
// Deliberately absent here: provider SDK/network code (the narrowly scoped
// adapter is separate), streaming, context compaction, provider routing, model
// escalation, CLI wiring, and multi-agent behavior. Those are later issues.

import { randomUUID } from "node:crypto";
import { TOOL_NAMES, TOOLS } from "./tools.mjs";
import { createEvent, createEventCollector } from "./events.mjs";
import { loadAgentContext } from "./context.mjs";
import { buildToolProtocol, validateProviderCall } from "./provider.mjs";
import { summarizeToolCall, summarizeToolResult, utf8Bytes } from "./privacy.mjs";
import {
  executeRead,
  executeWrite,
  executeList,
  executeGrep,
  executeCommand,
} from "./tool-execution.mjs";

// Hard stop so a broken/mock provider can never loop forever.
export const DEFAULT_MAX_TURNS = 8;

const DEFAULT_EXECUTORS = {
  read: executeRead,
  list: executeList,
  grep: executeGrep,
  write: executeWrite,
  command: executeCommand,
};

// `workspaceRoot` is an OAF-reserved argument. The model must never be able to
// supply or replace it: it is stripped from tool args during validation and
// injected only by the loop after validation succeeds.
const RESERVED_ARGS = new Set(["workspaceRoot"]);

function buildSystem(context) {
  return context.documents
    .map((document) => `--- ${document.source}:${document.path} ---\n${document.content}`)
    .join("\n\n");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesJsonType(value, type) {
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && !Number.isNaN(value);
  return false;
}

// Validate model-supplied tool args against the registered tool's argsSchema.
// No third-party validator: only the primitive types, enum, minimum, required
// fields, and top-level key set used by the current five schemas are checked.
// Unknown keys are rejected; the reserved `workspaceRoot` key is stripped (never
// trusted from the model). Returns a copy with the reserved key removed so it
// can never reach an executor. Throws on any violation (fail closed).
function validateToolArgs(tool, args) {
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

  const validated = {};
  for (const [key, value] of Object.entries(args)) {
    if (RESERVED_ARGS.has(key)) continue;
    validated[key] = value;
    if (value === undefined) continue;
    const prop = properties[key];
    if (!matchesJsonType(value, prop.type)) {
      throw new Error(`tool '${tool.name}' argument '${key}' must be type ${prop.type}`);
    }
    if (prop.type === "integer" && typeof prop.minimum === "number" && value < prop.minimum) {
      throw new Error(`tool '${tool.name}' argument '${key}' must be >= ${prop.minimum}`);
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      throw new Error(`tool '${tool.name}' argument '${key}' must be one of: ${prop.enum.join(", ")}`);
    }
  }
  return validated;
}

// Coerce and validate a provider response into the shape the loop relies on.
// A malformed response fails closed by throwing before any dispatch.
function normalizeResponse(response, turn) {
  if (response === null || typeof response !== "object" || Array.isArray(response)) {
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
function recordUniqueToolCallIds(toolCalls, seenIds, turn) {
  const currentIds = new Set();
  for (const call of toolCalls) {
    if (!call || typeof call !== "object" || typeof call.id !== "string" || call.id.length === 0) continue;
    if (currentIds.has(call.id) || seenIds.has(call.id)) {
      throw new Error(`provider response reuses a tool-call ID (turn ${turn})`);
    }
    currentIds.add(call.id);
  }
  for (const id of currentIds) seenIds.add(id);
}

export async function runAgentLoop({
  task,
  workspaceRoot,
  provider,
  maxTurns = DEFAULT_MAX_TURNS,
  oafRoot,
  runId,
  commandExecutor = executeCommand,
}) {
  if (typeof task !== "string" || task.length === 0) {
    throw new Error("task is required");
  }
  if (!provider || typeof provider.complete !== "function") {
    throw new Error("provider with a complete() method is required");
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error("maxTurns must be a positive integer");
  }

  const collector = createEventCollector();
  const run = runId ?? `run_${randomUUID()}`;
  collector.record(createEvent("agent_start", { runId: run, taskBytes: utf8Bytes(task), taskProvided: true }));

  const context = await loadAgentContext({ workspaceRoot, oafRoot });
  const system = buildSystem(context);
  const tools = buildToolProtocol();
  const executors = { ...DEFAULT_EXECUTORS, command: commandExecutor };

  const messages = [{ role: "user", content: task }];
  let turn = 0;
  let terminalReason = null;
  let finalContent = null;
  const providerCalls = [];
  const seenToolCallIds = new Set();

  while (turn < maxTurns) {
    turn++;
    collector.record(createEvent("turn_start", { turn }));

    const request = { system, messages, tools };
    collector.record(createEvent("message_start", { turn }));

    let response;
    try {
      response = normalizeResponse(await provider.complete(request), turn);
      recordUniqueToolCallIds(response.toolCalls, seenToolCallIds, turn);
      if (response.providerCall !== null) {
        providerCalls.push({ turn, ...validateProviderCall(response.providerCall) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A provider/normalization failure closes the message lifecycle with an
      // error indication, then ends the run as a failed result (no dispatch).
      collector.record(createEvent("message_end", { turn, disposition: "provider_error", contentPresent: false, contentBytes: 0, toolCallCount: 0, errorCode: "provider_error" }));
      collector.record(createEvent("agent_end", { runId: run, status: "failed", turns: turn, terminalReason: "provider_error" }));
      return {
        runId: run,
        status: "failed",
        turns: turn,
        terminalReason: "provider_error",
        content: null,
        providerCalls,
        context,
        events: collector.all(),
      };
    }
    const requested = response.toolCalls;
    collector.record(createEvent("message_end", {
      turn,
      disposition: requested.length === 0 ? "terminal" : "tool_calls",
      contentPresent: typeof response.content === "string" && response.content.length > 0,
      contentBytes: utf8Bytes(response.content),
      toolCallCount: requested.length,
      errorCode: null,
    }));
    if (requested.length === 0) {
      finalContent = response.content;
      terminalReason = "assistant_terminal";
      break;
    }

    const toolResults = [];
    for (let index = 0; index < requested.length; index++) {
      const call = requested[index];
      const toolName = call && typeof call === "object" ? call.name : undefined;
      const auditToolName = typeof toolName === "string" && TOOLS[toolName] ? toolName : null;
      const providerId = (call && call.id) || `call_${turn}_${index + 1}`;
      const auditId = `tool_${turn}_${index + 1}`;

      collector.record(createEvent("tool_call", { toolCallId: auditId, toolName: auditToolName, summary: summarizeToolCall(auditToolName, call?.args) }));

      // Unknown or malformed tool name: recorded and rejected before any
      // executor runs. No tool_execution_start/end is emitted for this.
      if (!toolName || typeof toolName !== "string" || !TOOLS[toolName]) {
        const error = `unknown or malformed tool: ${String(toolName)}`;
        collector.record(createEvent("tool_result", { toolCallId: auditId, toolName: auditToolName, summary: {}, errorCode: "rejected" }));
        toolResults.push({ toolCallId: providerId, toolName: toolName ?? null, error });
        continue;
      }

      // Validate args. A validation failure is a rejection: emit tool_result
      // only, never tool_execution_start/end (no executor was invoked).
      let validated;
      try {
        validated = validateToolArgs(TOOLS[toolName], call.args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        collector.record(createEvent("tool_result", { toolCallId: auditId, toolName, summary: {}, errorCode: "rejected" }));
        toolResults.push({ toolCallId: providerId, toolName, error: message });
        continue;
      }

      // Trusted OAF-owned arguments win: the loop injects workspaceRoot only
      // here, after validation, overriding any provider data (which was
      // stripped). The executor-level boundary remains as defense in depth.
      const executor = executors[toolName];
      collector.record(createEvent("tool_execution_start", { toolCallId: auditId, toolName }));
      let executorResult;
      let executorError;
      try {
        executorResult = await executor({ ...validated, workspaceRoot });
      } catch (error) {
        executorError = error instanceof Error ? error.message : String(error);
      }

      if (executorError !== undefined) {
        collector.record(createEvent("tool_execution_end", { toolCallId: auditId, toolName, success: false }));
        collector.record(createEvent("tool_result", { toolCallId: auditId, toolName, summary: {}, errorCode: "execution_error" }));
        toolResults.push({ toolCallId: providerId, toolName, error: executorError });
      } else {
        collector.record(createEvent("tool_execution_end", { toolCallId: auditId, toolName, success: true }));
        try {
          collector.record(createEvent("tool_result", { toolCallId: auditId, toolName, summary: summarizeToolResult(toolName, executorResult), errorCode: null }));
        } catch (eventError) {
          // Event recording failed after the tool succeeded. Record a bounded
          // rejection without losing the successful result or emitting a second
          // execution-end event. The provider still receives the exact result.
          const eventMessage = eventError instanceof Error ? eventError.message : String(eventError);
          collector.record(createEvent("tool_result", { toolCallId: auditId, toolName, summary: {}, errorCode: "rejected" }));
          collector.all().length; // force event stream to stay consistent
        }
        toolResults.push({ toolCallId: providerId, toolName, result: executorResult });
      }
    }

    messages.push({ role: "assistant", content: response.content, toolCalls: requested });
    messages.push({ role: "tool", toolResults });
  }

  if (terminalReason === null) {
    // The loop left the while guard because maxTurns was reached.
    terminalReason = "max_turns";
  }

  const status = terminalReason === "max_turns" ? "exhausted" : "success";
  collector.record(createEvent("agent_end", { runId: run, status, turns: turn, terminalReason }));

  return {
    runId: run,
    status,
    turns: turn,
    terminalReason,
    content: finalContent,
    providerCalls,
    context,
    events: collector.all(),
  };
}
