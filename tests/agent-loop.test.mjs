// Focused test for the minimal Alpha 1 agent loop with a mock provider seam.
// Uses only Node built-ins; no real provider, API key, or network.
import { deepEqual } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop as runTypedAgentLoop } from "../lib/agent/loop.ts";
/** @type {(options: any) => Promise<{ events: any[], [key: string]: any }>} */
const runAgentLoop = runTypedAgentLoop;
import { createMockProvider, buildToolProtocol } from "../lib/agent/provider.ts";
import { TOOL_NAMES } from "../lib/agent/tools.ts";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

function assertDeepEqual(actual, expected, message) {
  try {
    deepEqual(actual, expected);
    console.log(`PASS  ${message}`);
  } catch {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = [];
const outsideDirs = [];

function withFixture() {
  const fixture = copyGeneratedAppFixture();
  fixtures.push(fixture);
  return fixture.workspace;
}

function makeOutsideDir() {
  const dir = mkdtempSync(join(tmpdir(), "oaf-loop-outside-"));
  outsideDirs.push(dir);
  return dir;
}

function types(events) {
  return events.map((event) => event.type);
}

try {
  // 1. One complete tool-call round trip: read the fixture README, then stop.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "c1", name: "read", args: { path: "README.md" } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoop({ task: "read the readme", workspaceRoot: workspace, provider, maxTurns: 4 });

    assert(result.status === "success" && result.terminalReason === "assistant_terminal", "round trip ends on terminal response");
    assert(result.turns === 2, "round trip takes two turns");
    assert(types(result.events).join(",") ===
      "agent_start,turn_start,message_start,message_end,tool_call,tool_execution_start,tool_execution_end,tool_result,turn_start,message_start,message_end,agent_end",
      "round trip emits AgentEvents in lifecycle order");

    const toolResult = result.events.find((event) => event.type === "tool_result");
    assert(toolResult.toolName === "read", "read tool result names the tool");
    assert(toolResult.summary.path === "README.md" && toolResult.summary.bytes > 0 && toolResult.summary.truncated === false,
      "read tool result records path, byte count, and truncation flag");
  }

  // 2. Context is supplied through the provider seam.
  {
    const workspace = withFixture();
    let captured;
    const provider = createMockProvider({
      script: [{ content: "ok", toolCalls: [] }],
      onRequest: (request) => {
        captured = request;
      },
    });
    await runAgentLoop({ task: "hi", workspaceRoot: workspace, provider });

    assert(typeof captured.system === "string" && captured.system.includes("Opinionated App Factory"),
      "provider receives assembled OAF context in request.system");
    assert(!("apiKey" in captured) && !("key" in captured), "provider request carries no API key");
    assertDeepEqual(captured.tools, buildToolProtocol(), "provider receives the fixed tool protocol");
  }

  // 3. The fixed tool registry is used, not a parallel invented registry.
  {
    const workspace = withFixture();
    let captured;
    const provider = createMockProvider({
      script: [{ content: "ok", toolCalls: [] }],
      onRequest: (request) => {
        captured = request;
      },
    });
    await runAgentLoop({ task: "hi", workspaceRoot: workspace, provider });

    const providedNames = captured.tools.map((tool) => tool.name).sort();
    assert(JSON.stringify(providedNames) === JSON.stringify([...TOOL_NAMES].sort()),
      "provider receives exactly the 5 fixed tool names");
    assert(captured.tools.every((tool) => typeof tool.argsSchema === "object" && tool.argsSchema !== null),
      "each provided tool carries its registered argsSchema");
  }

  // 4. A terminal assistant response ends the run after one turn.
  {
    const workspace = withFixture();
    const provider = createMockProvider({ script: [{ content: "all set", toolCalls: [] }] });
    const result = await runAgentLoop({ task: "do nothing", workspaceRoot: workspace, provider, maxTurns: 5 });

    assert(result.status === "success" && result.turns === 1, "terminal response stops after one turn");
    assert(result.content === "all set", "terminal content is returned");
    assert(types(result.events).join(",") === "agent_start,turn_start,message_start,message_end,agent_end",
      "terminal run emits start/turn/message/end only");
  }

  // 5. Unknown or malformed tool requests fail closed (no fake execution events).
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "bad1", name: "hack", args: { path: "x" } }] },
        { content: "cleaned up", toolCalls: [] },
      ],
    });
    const result = await runAgentLoop({ task: "be evil", workspaceRoot: workspace, provider, maxTurns: 4 });

    const badResult = result.events.find((event) => event.type === "tool_result" && event.errorCode === "rejected");
    assert(!!badResult && badResult.toolName === null,
      "unknown tool request fails closed without retaining its raw name");
    assert(!result.events.some((event) => event.type === "tool_result" && event.toolName === "read"),
      "unknown tool is never dispatched to a real executor");
    assert(!result.events.some((event) => event.type === "tool_execution_start" || event.type === "tool_execution_end"),
      "rejected unknown tool emits no tool_execution_start/end");

    // Malformed call (no name) also fails closed.
    const provider2 = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "bad2", args: {} }] },
        { content: "ok", toolCalls: [] },
      ],
    });
    const result2 = await runAgentLoop({ task: "be vague", workspaceRoot: withFixture(), provider: provider2 });
    const malformed = result2.events.find((event) => event.type === "tool_result" && event.errorCode);
    assert(!!malformed && malformed.toolName === null, "malformed tool call (missing name) fails closed");
    assert(!result2.events.some((event) => event.type === "tool_execution_start" || event.type === "tool_execution_end"),
      "rejected malformed tool emits no tool_execution_start/end");
  }

  // 6. The max-turn limit stops a nonterminating provider.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: (request, callCount) => ({ content: null, toolCalls: [{ id: `loop-${callCount}`, name: "read", args: { path: "README.md" } }] }),
    });
    const result = await runAgentLoop({ task: "loop", workspaceRoot: workspace, provider, maxTurns: 3 });

    assert(result.status === "exhausted" && result.terminalReason === "max_turns", "nonterminating provider stops at max_turns");
    assert(result.turns === 3, "exactly maxTurns turns run");
    assert(provider.callCount === 3, "provider is not called beyond the turn limit");
  }

  // 7. A malformed provider response fails closed as a failed run (no dispatch).
  {
    const workspace = withFixture();
    const broken = { complete: async () => null };
    const result = await runAgentLoop({ task: "x", workspaceRoot: workspace, provider: broken });

    assert(result.status === "failed" && result.terminalReason === "provider_error",
      "malformed provider response ends the run as failed");
    assert(!result.events.some((event) => event.type === "tool_call"),
      "no tool is dispatched on a failed provider response");
    const msgEnd = result.events.find((event) => event.type === "message_end");
    assert(!!msgEnd && msgEnd.errorCode === "provider_error",
      "message_end records the provider error before the run ends");
  }

  // 8. No real network or provider SDK surfaces in the loop or provider module.
  {
    const loopSource = readFileSync(join(repoRoot, "lib", "agent", "loop.ts"), "utf8");
    const providerSource = readFileSync(join(repoRoot, "lib", "agent", "provider.ts"), "utf8");
    const forbidden = /(node:(http|https|net)\b|\bfetch\s*\(|from\s+["'](?:axios|undici|openai|anthropic|@anthropic|@openai)["'])/i;
    assert(!forbidden.test(loopSource), "loop module imports no network/provider SDK");
    assert(!loopSource.includes("openai-compatible-provider"), "loop imports no concrete OpenAI-compatible adapter");
    assert(!forbidden.test(providerSource), "provider module imports no network/provider SDK");
  }

  // 9. Missing loop inputs fail closed.
  {
    const provider = createMockProvider({ script: [{ content: "ok", toolCalls: [] }] });
    let threw = false;
    try {
      await runAgentLoop({ workspaceRoot: withFixture(), provider });
    } catch (error) {
      threw = /task is required/.test(error.message);
    }
    assert(threw, "loop requires a task");
  }

  // 10. Focused lifecycle: the provider call occurs between message_start and
  // message_end. Deterministic via event order + single call, not timestamps.
  {
    const provider = createMockProvider({ script: [{ content: "between", toolCalls: [] }] });
    const result = await runAgentLoop({ task: "t", workspaceRoot: withFixture(), provider });

    const t = types(result.events);
    const iStart = t.indexOf("message_start");
    const iEnd = t.indexOf("message_end");
    assert(iStart > -1 && iEnd > -1 && iStart < iEnd, "message_start precedes message_end");
    assert(provider.callCount === 1, "provider.complete is invoked exactly once per terminal turn");
    assert(result.content === "between", "message_end captured the response content (recorded after the call)");
  }

  // 11. Provider/normalization failure closes the message lifecycle with an
  // error indication before the run ends as failed.
  {
    const workspace = withFixture();
    const throwing = { complete: async () => { throw new Error("boom"); } };
    const result = await runAgentLoop({ task: "x", workspaceRoot: workspace, provider: throwing });

    assert(result.status === "failed" && result.terminalReason === "provider_error", "provider throw ends the run as failed");
    const t = types(result.events);
    assert(t[t.length - 3] === "message_start" && t[t.length - 2] === "message_end" && t[t.length - 1] === "agent_end",
      "events end with message_start, message_end(error), agent_end");
    const msgEnd = result.events.find((event) => event.type === "message_end");
    assert(msgEnd.errorCode === "provider_error", "message_end records bounded provider-error classification");
  }

  // 12. BLOCKER 1: a read call containing args.workspaceRoot cannot read from
  // an outside directory — the trusted loop root always wins.
  {
    const outside = makeOutsideDir();
    writeFileSync(join(outside, "README.md"), "EVIL README CONTENT");
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "r1", name: "read", args: { path: "README.md", workspaceRoot: outside } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoop({ task: "read", workspaceRoot: workspace, provider, maxTurns: 4 });

    const readResult = result.events.find((event) => event.type === "tool_result" && event.toolName === "read");
    assert(readResult.summary.path === "README.md" && readResult.summary.bytes > 0,
      "read used the trusted workspace root and records only safe metadata");
    assert(!result.events.some((event) => JSON.stringify(event).includes("EVIL README CONTENT")),
      "no event leaks the outside file contents");
  }

  // 13. BLOCKER 1: a write call containing args.workspaceRoot cannot modify an
  // outside directory.
  {
    const outside = makeOutsideDir();
    const outsidePayload = join(outside, "payload.txt");
    writeFileSync(outsidePayload, "EVIL-OUTSIDE");
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "w1", name: "write", args: { path: "payload.txt", content: "PWNED", workspaceRoot: outside } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    await runAgentLoop({ task: "write", workspaceRoot: workspace, provider, maxTurns: 4 });

    assert(readFileSync(outsidePayload, "utf8") === "EVIL-OUTSIDE",
      "outside file was NOT modified by the malicious workspaceRoot");
  }

  // 14. BLOCKER 1: a command call containing args.workspaceRoot passes the
  // actual loop workspace to the injected command executor.
  {
    const calls = [];
    const myExecutor = async (options) => {
      calls.push(options);
      return { exitCode: 0, stdout: "ok", stderr: "", truncated: false };
    };
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "c1", name: "command", args: { command: "echo hi", workspaceRoot: "/tmp/does-not-matter-evil" } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoop({ task: "cmd", workspaceRoot: workspace, provider, commandExecutor: myExecutor });

    assert(calls.length === 1, "injected command executor was called once");
    assert(calls[0].workspaceRoot === workspace, "executor received the trusted loop workspaceRoot");
    assert(calls[0].workspaceRoot !== "/tmp/does-not-matter-evil", "attacker workspaceRoot was not forwarded");
    assert(calls[0].command === "echo hi", "legitimate command argument is preserved");
    assert(result.status === "success", "command run with stripped root completes");
  }

  // 15. BLOCKER 1: unexpected keys and non-object args fail closed without any
  // executor dispatch.
  {
    const calls = [];
    const neverCalled = async (options) => {
      calls.push(options);
      throw new Error("executor should not have been called");
    };

    // Unexpected top-level key.
    const providerA = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "x", name: "command", args: { command: "echo hi", bogus: 1 } }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const resultA = await runAgentLoop({ task: "a", workspaceRoot: withFixture(), provider: providerA, commandExecutor: neverCalled });
    assert(calls.length === 0, "executor not called when args have an unexpected key");
    const errA = resultA.events.find((event) => event.type === "tool_result" && event.toolName === "command");
    assert(!!errA && errA.errorCode === "rejected", "unexpected key rejected with a safe error result");
    assert(!resultA.events.some((event) => event.type === "tool_execution_start"),
      "no tool_execution_start emitted for rejected args");

    // Non-object args.
    const providerB = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "y", name: "command", args: null }] },
        { content: "done", toolCalls: [] },
      ],
    });
    const resultB = await runAgentLoop({ task: "b", workspaceRoot: withFixture(), provider: providerB, commandExecutor: neverCalled });
    assert(calls.length === 0, "executor not called when args are non-object");
    const errB = resultB.events.find((event) => event.type === "tool_result" && event.toolName === "command");
    assert(!!errB && errB.errorCode === "rejected", "non-object args rejected with a safe error result");
  }
} finally {
  for (const fixture of fixtures) fixture.cleanup();
  for (const dir of outsideDirs) rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} loop check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent-loop checks passed.");
