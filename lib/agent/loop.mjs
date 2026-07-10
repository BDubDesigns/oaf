// Minimal OAF-owned agent loop (issue #31).
//
// The smallest useful loop: load context, call a provider through the seam in
// provider.mjs, dispatch registered tools via their existing execution
// implementations, emit AgentEvents, and stop on a terminal response or the
// max-turn limit.
//
// Deliberately absent: a real provider SDK, network/API calls, streaming,
// context compaction, receipt writing, provider routing, model escalation, CLI
// wiring, and multi-agent behavior. Those are later issues.

import { randomUUID } from "node:crypto";
import { TOOL_NAMES, TOOLS } from "./tools.mjs";
import { createEvent, createEventCollector } from "./events.mjs";
import { loadAgentContext } from "./context.mjs";
import { buildToolProtocol } from "./provider.mjs";
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

function buildSystem(context) {
  return context.documents
    .map((document) => `--- ${document.source}:${document.path} ---\n${document.content}`)
    .join("\n\n");
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
  return { content: response.content ?? null, toolCalls };
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
  collector.record(createEvent("agent_start", { runId: run, task, workspaceRoot }));

  const context = await loadAgentContext({ workspaceRoot, oafRoot });
  const system = buildSystem(context);
  const tools = buildToolProtocol();
  const executors = { ...DEFAULT_EXECUTORS, command: commandExecutor };

  const messages = [{ role: "user", content: task }];
  let turn = 0;
  let terminalReason = null;
  let finalContent = null;

  while (turn < maxTurns) {
    turn++;
    collector.record(createEvent("turn_start", { turn }));

    const request = { system, messages, tools };
    const response = normalizeResponse(await provider.complete(request), turn);

    collector.record(createEvent("message_start", { turn }));
    collector.record(createEvent("message_end", { turn, content: response.content }));

    const requested = response.toolCalls;
    if (requested.length === 0) {
      finalContent = response.content;
      terminalReason = "assistant_terminal";
      break;
    }

    const toolResults = [];
    for (let index = 0; index < requested.length; index++) {
      const call = requested[index];
      const toolName = call && typeof call === "object" ? call.name : undefined;
      const toolCallId = (call && call.id) || `call_${turn}_${index + 1}`;

      collector.record(createEvent("tool_call", { toolCallId, toolName: toolName ?? null, args: call?.args ?? null }));

      if (!toolName || typeof toolName !== "string" || !TOOLS[toolName]) {
        // Unknown or malformed tool request: recorded, never dispatched.
        collector.record(createEvent("tool_execution_start", { toolCallId }));
        collector.record(createEvent("tool_execution_end", { toolCallId, error: true }));
        const error = `unknown or malformed tool: ${String(toolName)}`;
        collector.record(createEvent("tool_result", { toolCallId, toolName: toolName ?? null, error }));
        toolResults.push({ toolCallId, toolName: toolName ?? null, error });
        continue;
      }

      const executor = executors[toolName];
      collector.record(createEvent("tool_execution_start", { toolCallId }));
      try {
        const result = await executor({ workspaceRoot, ...call.args });
        collector.record(createEvent("tool_execution_end", { toolCallId }));
        collector.record(createEvent("tool_result", { toolCallId, toolName, result }));
        toolResults.push({ toolCallId, toolName, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        collector.record(createEvent("tool_execution_end", { toolCallId, error: true }));
        collector.record(createEvent("tool_result", { toolCallId, toolName, error: message }));
        toolResults.push({ toolCallId, toolName, error: message });
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
    context,
    events: collector.all(),
  };
}
