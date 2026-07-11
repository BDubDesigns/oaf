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
    assert(readEvent.summary.path === "README.md" && readEvent.summary.bytes > 0 && readEvent.summary.truncated === false, "read event retains project-relative path, byte count, and truncation flag");
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
    assert(result.receipt.checks.some((check) => check.name === "test" && check.exitCode === 7), "canonical recordable test command detected with exit code");
  }

  // 3. Raw tool args/results/errors cannot leak through safe audit summaries.
  {
    const root = workspace();
    const writeContent = "WRITE_CONTENT_SENTINEL_53";
    const grepPattern = "GREP_PATTERN_SENTINEL_53";
    const commandSecret = "CONNECTION_STRING=postgres://u:COMMAND_SECRET_53@host/db";
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
    for (const sentinel of [writeContent, grepPattern, "COMMAND_SECRET_53", errorSentinel, "TASK_AUTH_53"]) {
      assert(!all.includes(sentinel), `sentinel omitted from durable audit data: ${sentinel}`);
    }
    const writeEvent = result.events.find((event) => event.type === "tool_call" && event.toolName === "write");
    const grepEvent = result.events.find((event) => event.type === "tool_call" && event.toolName === "grep");
    const commandEvent = result.events.find((event) => event.type === "tool_call" && event.toolName === "command");
    assert(writeEvent.summary.path === "notes.txt" && writeEvent.summary.bytes === Buffer.byteLength(writeContent), "write event retains path and byte count only");
    assert(grepEvent.summary.path === "README.md" && !Object.hasOwn(grepEvent.summary, "pattern"), "grep event retains location without pattern");
    assert(commandEvent.summary.command === "<redacted command>" && commandEvent.summary.redacted === true, "suspicious command uses shared redaction marker");
  }

  // 4. Provider-supplied tool-call IDs are kept only in ephemeral state.
  {
    const root = workspace();
    const providerIdSentinel = "PROVIDER_ID_SENTINEL_53";
    const requests = [];
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: providerIdSentinel, name: "read", args: { path: "README.md" } }] },
        { content: "done", toolCalls: [] },
      ],
      onRequest: (request) => requests.push(request),
    });
    const result = await runAgentLoopWithReceipt({ task: "read", workspaceRoot: root, provider });
    const secondTool = requests[1].messages.find((message) => message.role === "tool");
    const all = `${JSON.stringify(result.events)}${JSON.stringify(result.receipt)}`;
    assert(!all.includes(providerIdSentinel), "provider-supplied tool-call ID absent from events and receipt");
    assert(secondTool.toolResults[0].toolCallId === providerIdSentinel, "provider receives exact original ID in tool result");
    const readCall = result.events.find((event) => event.type === "tool_call" && event.toolName === "read");
    const readResult = result.events.find((event) => event.type === "tool_result" && event.toolName === "read");
    assert(readCall.toolCallId === "tool_1_1" && readResult.toolCallId === "tool_1_1", "local audit ID pairs all durable events");
  }

  // 5. Only exact canonical recordable commands retain their identity.
  {
    const root = workspace();
    const executor = async () => ({ exitCode: 0, stdout: "", stderr: "", truncated: false });
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [
          { id: "echo-1", name: "command", args: { command: "echo UNLABELED_SECRET_SENTINEL" } },
          { id: "chain-1", name: "command", args: { command: "pnpm test && echo CHAINED_SENTINEL" } },
          { id: "extra-1", name: "command", args: { command: "pnpm test --unexpected" } },
          { id: "node-1", name: "command", args: { command: 'node -e "PRIVATE_SOURCE_SENTINEL"' } },
          { id: "cat-1", name: "command", args: { command: "cat .env" } },
          { id: "canon-1", name: "command", args: { command: "pnpm test" } },
          { id: "canon-2", name: "command", args: { command: "pnpm lint" } },
          { id: "canon-3", name: "command", args: { command: "pnpm typecheck" } },
          { id: "canon-4", name: "command", args: { command: "pnpm build" } },
          { id: "canon-5", name: "command", args: { command: "git status" } },
          { id: "canon-6", name: "command", args: { command: "git diff" } },
          { id: "canon-7", name: "command", args: { command: "git log --oneline" } },
        ] },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runAgentLoopWithReceipt({ task: "cmd", workspaceRoot: root, provider, commandExecutor: executor });
    const all = `${JSON.stringify(result.events)}${JSON.stringify(result.receipt)}`;
    assert(!all.includes("UNLABELED_SECRET_SENTINEL"), "echo command with unlabeled secret is redacted");
    assert(!all.includes("CHAINED_SENTINEL"), "chained pnpm test command is redacted");
    assert(!all.includes("PRIVATE_SOURCE_SENTINEL"), "node -e command is redacted");
    const commands = result.events.filter((e) => e.type === "tool_call" && e.toolName === "command");
    assert(commands[5].summary.command === "pnpm test" && commands[5].summary.redacted === false, "canonical pnpm test is identifiable");
    assert(commands[6].summary.command === "pnpm lint" && commands[6].summary.redacted === false, "canonical pnpm lint is identifiable");
    assert(commands[7].summary.command === "pnpm typecheck" && commands[7].summary.redacted === false, "canonical pnpm typecheck is identifiable");
    assert(commands[8].summary.command === "pnpm build" && commands[8].summary.redacted === false, "canonical pnpm build is identifiable");
    assert(commands[9].summary.command === "git status" && commands[9].summary.redacted === false, "canonical git status is identifiable");
    assert(commands[10].summary.command === "git diff" && commands[10].summary.redacted === false, "canonical git diff is identifiable");
    assert(commands[11].summary.command === "git log --oneline" && commands[11].summary.redacted === false, "canonical git log --oneline is identifiable");
    assert(commands[2].summary.command === "<redacted command>" && commands[2].summary.redacted === true, "pnpm test --unexpected is redacted");
    assert(!result.receipt.checks.some((c) => c.name === "test" && result.receipt.commands[2].command === "pnpm test"), "non-canonical pnpm test is not a test check");
  }

  // 6. Provider ID with control characters does not enter audit data.
  {
    const root = workspace();
    const requests = [];
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: "id\x00with\x00null", name: "read", args: { path: "README.md" } }] },
        { content: "done", toolCalls: [] },
      ],
      onRequest: (request) => requests.push(request),
    });
    const result = await runAgentLoopWithReceipt({ task: "read", workspaceRoot: root, provider });
    const secondTool = requests[1].messages.find((message) => message.role === "tool");
    const all = `${JSON.stringify(result.events)}${JSON.stringify(result.receipt)}`;
    assert(!all.includes("id\x00with\x00null"), "provider ID with NUL absent from audit data");
    assert(secondTool.toolResults[0].toolCallId === "id\x00with\x00null", "provider receives exact control-char ID ephemerally");
  }

  // 7. Long provider ID does not enter audit data.
  {
    const root = workspace();
    const longId = "x".repeat(500);
    const requests = [];
    const provider = createMockProvider({
      script: [
        { content: null, toolCalls: [{ id: longId, name: "read", args: { path: "README.md" } }] },
        { content: "done", toolCalls: [] },
      ],
      onRequest: (request) => requests.push(request),
    });
    const result = await runAgentLoopWithReceipt({ task: "read", workspaceRoot: root, provider });
    const secondTool = requests[1].messages.find((message) => message.role === "tool");
    const all = `${JSON.stringify(result.events)}${JSON.stringify(result.receipt)}`;
    assert(!all.includes(longId), "long provider ID absent from audit data");
    assert(secondTool.toolResults[0].toolCallId === longId, "provider receives exact long ID ephemerally");
  }

  // 8. Duplicate provider IDs are still rejected before dispatch.
  {
    const root = workspace();
    let turn = 0;
    const provider = createMockProvider({
      script: async () => {
        turn++;
        return { content: null, toolCalls: [{ id: "dup-id", name: "read", args: { path: "README.md" } }] };
      },
    });
    const result = await runAgentLoopWithReceipt({ task: "read twice", workspaceRoot: root, provider, maxTurns: 3 });
    assert(result.receipt.status === "failed" && result.receipt.terminalReason === "provider_error", "duplicate provider ID rejected before dispatch");
    assert(result.events.filter((e) => e.type === "tool_call").length === 1, "only first duplicate ID call recorded");
  }
} finally {
  for (const fixture of fixtures) fixture.cleanup();
}

if (failures > 0) { console.error(`\n${failures} event privacy check(s) failed.`); process.exit(1); }
console.log("\nAll agent-event privacy checks passed.");
