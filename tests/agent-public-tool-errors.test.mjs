import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";
import { runAgentLoop } from "../lib/agent/loop.ts";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
async function roundTrip(call, executor) {
  const fixture = copyGeneratedAppFixture(); let request;
  try {
    let count = 0;
    const provider = { complete: async (value) => { request = value; return count++ === 0 ? { content: null, toolCalls: [call] } : { content: "done", toolCalls: [] }; } };
    const run = await runAgentLoop({ task: "test", workspaceRoot: fixture.workspace, oafRoot: process.cwd(), provider, commandExecutor: executor });
    return { run, request, workspace: fixture.workspace };
  } finally { fixture.cleanup(); }
}
const missing = await roundTrip({ id: "missing_1", name: "read", args: { path: "app/does-not-exist.ts" } });
const missingResult = missing.request.messages.find((message) => message.role === "tool")?.toolResults?.[0];
assert(missingResult?.error === "requested path does not exist" && !JSON.stringify(missing.request).includes(missing.workspace), "missing read sends bounded no-path failure");
const sentinels = "/ABS_SENTINEL API_KEY_SENTINEL Authorization: Bearer SECRET";
const unexpected = await roundTrip({ id: "throw_1", name: "command", args: { command: "pnpm test" } }, async () => { throw new Error(sentinels); });
const unexpectedResult = unexpected.request.messages.find((message) => message.role === "tool")?.toolResults?.[0];
assert(unexpectedResult?.error === "tool execution failed" && !JSON.stringify(unexpected.request).includes("SENTINEL") && !JSON.stringify(unexpected.run.events).includes("SENTINEL"), "unexpected executor message never reaches provider or events");
const bypass = await roundTrip({ id: "bypass_1", name: "command", args: { command: "pnpm test" } }, async () => { throw new (await import("../lib/agent/tool-errors.mjs")).AgentToolError("/ABS API_KEY Authorization", "SENTINEL"); });
const bypassResult = bypass.request.messages.find((message) => message.role === "tool")?.toolResults?.[0];
assert(bypassResult?.error === "tool execution failed" && !JSON.stringify(bypass.request).includes("SENTINEL"), "bogus public error code falls back to fixed generic failure");
if (failures) process.exit(1);
console.log("All public tool-error checks passed.");
