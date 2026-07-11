// End-to-end privacy boundary tests: providers receive exact ephemeral tool
// results, while events and receipts retain only safe audit summaries.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoopWithReceipt } from "../lib/agent/receipt.mjs";
import { createMockProvider } from "../lib/agent/provider.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(condition, message) { if (condition) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }

const fixtures = [];
function workspace() { const fixture = copyGeneratedAppFixture(); fixtures.push(fixture); return fixture.workspace; }

try {
  // 1. Exact read content stays in the next provider request, never audit data.
  {
    const root = workspace();
    const readSentinel = "READ_CONTENT_SENTINEL_53";
    writeFileSync(join(root, "README.md"), `${readFileSync(join(root, "README.md"), "utf8")}\n${readSentinel}\n`);
    const requests = [];
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "read-1", name: "read", args: { path: "README.md" } }] },
        { content: "TERMINAL_OUTPUT_SENTINEL_53", toolCalls: [] },
      ],
      onRequest: (request) => requests.push(request),
    });
    const result = await runAgentLoopWithReceipt({ task: "TOKEN=TASK_SENTINEL_53 read README", workspaceRoot: root, provider });
    const secondTool = requests[1].messages.find((message) => message.role === "tool");
    const serializedEvents = JSON.stringify(result.events);
    const serializedReceipt = JSON.stringify(result.receipt);
    assert(secondTool.toolResults[0].result.content.includes(readSentinel), "provider receives exact read content ephemerally");
    assert(!serializedEvents.includes(readSentinel) && !serializedReceipt.includes(readSentinel), "read content sentinel absent from events and receipt");
    assert(!serializedEvents.includes("TASK_SENTINEL_53") && !serializedReceipt.includes("TASK_SENTINEL_53"), "task sentinel absent from events and redacted receipt");
    assert(!serializedEvents.includes("TERMINAL_OUTPUT_SENTINEL_53") && !serializedReceipt.includes("TERMINAL_OUTPUT_SENTINEL_53"), "terminal model output absent from events and receipt");
    const readEvent = result.events.find((event) => event.type === "tool_result" && event.toolName === "read");
    assert(readEvent.summary.path === "README.md" && readEvent.summary.bytes > 0, "read event retains project-relative path and byte count");
    assert(!serializedEvents.includes(root), "events contain no absolute workspace path");
  }

  // 2. Command output remains ephemeral; events/receipt retain only safe facts.
  {
    const root = workspace();
    const stdout = "COMMAND_STDOUT_SENTINEL_53";
    const stderr = "COMMAND_STDERR_SENTINEL_53";
    const requests = [];
    const executor = async () => ({ exitCode: 7, stdout, stderr, truncated: false });
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "cmd-1", name: "command", args: { command: "pnpm test" } }] },
        { content: "done", toolCalls: [] },
      ],
      onRequest: (request) => requests.push(request),
    });
    const result = await runAgentLoopWithReceipt({ task: "run test", workspaceRoot: root, provider, commandExecutor: executor });
    const secondTool = requests[1].messages.find((message) => message.role === "tool");
    const commandEvent = result.events.find((event) => event.type === "tool_result" && event.toolName === "command");
    const serializedEvents = JSON.stringify(result.events);
    const serializedReceipt = JSON.stringify(result.receipt);
    assert(secondTool.toolResults[0].result.stdout === stdout && secondTool.toolResults[0].result.stderr === stderr, "provider receives exact command output ephemerally");
    assert(commandEvent.summary.exitCode === 7 && commandEvent.summary.stdoutBytes === Buffer.byteLength(stdout) && commandEvent.summary.stderrBytes === Buffer.byteLength(stderr), "command event retains exit code and output byte counts");
    assert(!serializedEvents.includes(stdout) && !serializedEvents.includes(stderr) && !serializedReceipt.includes(stdout) && !serializedReceipt.includes(stderr), "command output sentinels absent from events and receipt");
    assert(result.receipt.checks.some((check) => check.name === "test" && check.exitCode === 7), "safe check detection and exit code remain intact");
  }

  // 3. Raw tool args/results/errors cannot leak through safe audit summaries.
  {
    const root = workspace();
    const writeContent = "WRITE_CONTENT_SENTINEL_53";
    const grepPattern = "GREP_PATTERN_SENTINEL_53";
    const commandSecret = "curl -H 'Authorization: Bearer AUTH_VALUE_53' CONNECTION_STRING=postgres://u:COMMAND_SECRET_53@host/db";
    const errorSentinel = "EXECUTION_ERROR_SENTINEL_53";
    writeFileSync(join(root, "README.md"), `${grepPattern} matched text\n`);
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [
          { id: "write-1", name: "write", args: { path: "notes.txt", content: writeContent } },
          { id: "grep-1", name: "grep", args: { pattern: grepPattern, path: "README.md" } },
          { id: "cmd-1", name: "command", args: { command: commandSecret } },
        ] },
        { content: "done", toolCalls: [] },
      ],
    });
    const executor = async () => { throw new Error(errorSentinel); };
    const result = await runAgentLoopWithReceipt({ task: "TOKEN=TASK_AUTH_53", workspaceRoot: root, provider, commandExecutor: executor });
    const all = `${JSON.stringify(result.events)}${JSON.stringify(result.receipt)}`;
    for (const sentinel of [writeContent, grepPattern, "COMMAND_SECRET_53", "AUTH_VALUE_53", errorSentinel, "TASK_AUTH_53"]) {
      assert(!all.includes(sentinel), `sentinel omitted from durable audit data: ${sentinel}`);
    }
    const writeEvent = result.events.find((event) => event.type === "tool_call" && event.toolName === "write");
    const grepEvent = result.events.find((event) => event.type === "tool_call" && event.toolName === "grep");
    const commandEvent = result.events.find((event) => event.type === "tool_call" && event.toolName === "command");
    assert(writeEvent.summary.path === "notes.txt" && writeEvent.summary.bytes === Buffer.byteLength(writeContent), "write event retains path and byte count only");
    assert(grepEvent.summary.path === "README.md" && !Object.hasOwn(grepEvent.summary, "pattern"), "grep event retains location without pattern");
    assert(commandEvent.summary.command === "<redacted command>" && commandEvent.summary.redacted === true, "suspicious command uses shared redaction marker");
  }
} finally {
  for (const fixture of fixtures) fixture.cleanup();
}

if (failures > 0) { console.error(`\n${failures} event privacy check(s) failed.`); process.exit(1); }
console.log("\nAll agent-event privacy checks passed.");
