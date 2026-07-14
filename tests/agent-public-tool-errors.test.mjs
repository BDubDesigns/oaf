import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";
import { runAgentLoop } from "../lib/agent/loop.ts";
import { AgentToolError, PUBLIC_TOOL_ERRORS, publicToolError } from "../lib/agent/tool-errors.ts";

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
for (const output of [
  publicToolError(new AgentToolError("AGENT_PATH_DENIED")),
  publicToolError(new AgentToolError("PATH_NOT_FOUND")),
  publicToolError(new AgentToolError("NOT_A_FILE")),
  publicToolError(new AgentToolError("NOT_A_DIRECTORY")),
  publicToolError(new AgentToolError("INVALID_LINE_RANGE")),
  publicToolError(new AgentToolError("INVALID_TOOL_ARGUMENTS")),
  publicToolError(new AgentToolError("PATH_OUTSIDE_WORKSPACE")),
  publicToolError(new AgentToolError("TOOL_EXECUTION_FAILED")),
]) {
  assert(output.message === PUBLIC_TOOL_ERRORS[output.code], `canonical ${output.code} preserves its fixed public message`);
  assert(Object.keys(output).sort().join(",") === "code,message", `canonical ${output.code} public output has only code and message`);
}
const malformed = Reflect.construct(AgentToolError, ["/ABS_SENTINEL API_KEY_SENTINEL Authorization", new Error("CAUSE_SENTINEL")]);
const malformedOutput = publicToolError(malformed);
assert(malformedOutput.code === "TOOL_EXECUTION_FAILED" && malformedOutput.message === "tool execution failed", "invalid runtime constructor code collapses to generic failure");
for (const value of [null, "error", 1, [], {}, { code: "BOGUS" }, new Error("RAW_EXCEPTION_SENTINEL"), { code: "AGENT_PATH_DENIED", cause: "CAUSE_SENTINEL", stack: "STACK_SENTINEL" }, { code: "ENOENT", path: "/ABS_SENTINEL" }]) {
  const output = publicToolError(value);
  assert(Object.keys(output).sort().join(",") === "code,message", "foreign public output has only code and message");
  assert(!JSON.stringify(output).includes("SENTINEL"), "foreign public output excludes raw values");
}
assert(publicToolError({ code: "AGENT_PATH_DENIED" }).code === "AGENT_PATH_DENIED", "foreign path-denied code maps to canonical denial");
assert(publicToolError({ code: "ENOENT" }).code === "PATH_NOT_FOUND", "foreign ENOENT maps to canonical path-not-found");
assert(publicToolError({ code: "BOGUS" }).code === "TOOL_EXECUTION_FAILED", "foreign bogus code maps to generic failure");
const sentinels = "/ABS_SENTINEL API_KEY_SENTINEL Authorization: Bearer SECRET";
const unexpected = await roundTrip({ id: "throw_1", name: "command", args: { command: "pnpm test" } }, async () => { throw new Error(sentinels); });
const unexpectedResult = unexpected.request.messages.find((message) => message.role === "tool")?.toolResults?.[0];
assert(unexpectedResult?.error === "tool execution failed" && !JSON.stringify(unexpected.request).includes("SENTINEL") && !JSON.stringify(unexpected.run.events).includes("SENTINEL"), "unexpected executor message never reaches provider or events");
const bypass = await roundTrip({ id: "bypass_1", name: "command", args: { command: "pnpm test" } }, async () => { throw Reflect.construct(AgentToolError, ["/ABS API_KEY Authorization", "SENTINEL"]); });
const bypassResult = bypass.request.messages.find((message) => message.role === "tool")?.toolResults?.[0];
assert(bypassResult?.error === "tool execution failed" && !JSON.stringify(bypass.request).includes("SENTINEL"), "bogus public error code falls back to fixed generic failure");
if (failures) process.exit(1);
console.log("All public tool-error checks passed.");
