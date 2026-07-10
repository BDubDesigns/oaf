// Focused test for the minimal Alpha 1 agent loop with a mock provider seam.
// Uses only Node built-ins; no real provider, API key, or network.
import { deepEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop } from "../lib/agent/loop.mjs";
import { createMockProvider, buildToolProtocol } from "../lib/agent/provider.mjs";
import { TOOL_NAMES } from "../lib/agent/tools.mjs";
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

function withFixture() {
  const fixture = copyGeneratedAppFixture();
  fixtures.push(fixture);
  return fixture.workspace;
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
    assert(typeof toolResult.result.content === "string" && toolResult.result.content.includes("Opinionated App Factory"),
      "read tool result carries real workspace file content (real executor, not a stub)");
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

  // 5. Unknown or malformed tool requests fail closed.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "bad1", name: "hack", args: { path: "x" } }] },
        { content: "cleaned up", toolCalls: [] },
      ],
    });
    const result = await runAgentLoop({ task: "be evil", workspaceRoot: workspace, provider, maxTurns: 4 });

    const badResult = result.events.find((event) => event.type === "tool_result" && event.toolName === "hack");
    assert(!!badResult && typeof badResult.error === "string" && badResult.error.includes("unknown or malformed"),
      "unknown tool request fails closed with an error result");
    assert(!result.events.some((event) => event.type === "tool_result" && event.toolName === "read"),
      "unknown tool is never dispatched to a real executor");

    // Malformed call (no name) also fails closed.
    const provider2 = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "bad2", args: {} }] },
        { content: "ok", toolCalls: [] },
      ],
    });
    const result2 = await runAgentLoop({ task: "be vague", workspaceRoot: withFixture(), provider: provider2 });
    const malformed = result2.events.find((event) => event.type === "tool_result" && event.error);
    assert(!!malformed && malformed.toolName === null, "malformed tool call (missing name) fails closed");
  }

  // 6. The max-turn limit stops a nonterminating provider.
  {
    const workspace = withFixture();
    const provider = createMockProvider({
      script: () => ({ content: null, toolCalls: [{ id: "loop", name: "read", args: { path: "README.md" } }] }),
    });
    const result = await runAgentLoop({ task: "loop", workspaceRoot: workspace, provider, maxTurns: 3 });

    assert(result.status === "exhausted" && result.terminalReason === "max_turns", "nonterminating provider stops at max_turns");
    assert(result.turns === 3, "exactly maxTurns turns run");
    assert(provider.callCount === 3, "provider is not called beyond the turn limit");
  }

  // 7. A malformed provider response fails closed rather than dispatching.
  {
    const workspace = withFixture();
    const broken = { complete: async () => null };
    let threw = false;
    try {
      await runAgentLoop({ task: "x", workspaceRoot: workspace, provider: broken });
    } catch (error) {
      threw = /provider response must be an object/.test(error.message);
    }
    assert(threw, "malformed provider response throws before dispatch");
  }

  // 8. No real network or provider SDK surfaces in the loop or provider module.
  {
    const loopSource = readFileSync(join(repoRoot, "lib", "agent", "loop.mjs"), "utf8");
    const providerSource = readFileSync(join(repoRoot, "lib", "agent", "provider.mjs"), "utf8");
    const forbidden = /(node:(http|https|net)\b|\b(fetch|axios|undici|openai|anthropic|@anthropic|@openai)\b)/i;
    assert(!forbidden.test(loopSource), "loop module imports no network/provider SDK");
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
} finally {
  for (const fixture of fixtures) fixture.cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} loop check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent-loop checks passed.");
