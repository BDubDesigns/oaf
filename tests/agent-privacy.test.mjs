import assert from "node:assert/strict";
import {
  CANONICAL_COMMANDS,
  COMMAND_MODES,
  safeCount,
  safeProjectPath,
  summarizeCommand,
  summarizeToolCall,
  summarizeToolResult,
  utf8Bytes,
  validateCommandSummary,
} from "../lib/agent/privacy.ts";
import { createEvent } from "../lib/agent/events.ts";

/** @param {() => unknown} action @param {string} message */
function rejected(action, message) {
  assert.throws(action, { message });
}

// UTF-8 byte measurements are bounded metadata, never string code-unit counts.
assert.equal(utf8Bytes("hello"), 5);
assert.equal(utf8Bytes(""), 0);
assert.equal(utf8Bytes("A😀é"), Buffer.byteLength("A😀é", "utf8"));
for (const value of [null, 1, {}]) assert.equal(utf8Bytes(value), 0);

assert.equal(safeProjectPath("docs/readme.md"), "docs/readme.md");
assert.equal(safeProjectPath("docs\\readme.md"), "docs/readme.md");
assert.equal(safeProjectPath("  docs/readme.md  "), "  docs/readme.md  ");
assert.equal(safeProjectPath("./docs/./readme.md"), "./docs/./readme.md");
for (const value of ["", null, "/host/path", "C:\\host\\path", "a/../b", "a\\..\\b", "a/b/../c", "a\u0000b", "a\u001fb"]) assert.equal(safeProjectPath(value), null);
assert.equal(safeProjectPath("x".repeat(512)), "x".repeat(512));
assert.equal(safeProjectPath("x".repeat(513)), null);
assert.equal(safeProjectPath("é".repeat(256)), "é".repeat(256));
assert.equal(safeProjectPath("é".repeat(257)), null);

assert.deepEqual(CANONICAL_COMMANDS.map(({ command }) => command), ["pnpm test", "pnpm lint", "pnpm typecheck", "pnpm build", "git status", "git diff", "git log --oneline"]);
assert.deepEqual([...COMMAND_MODES], ["plan", "edit", "test", "browser", "install", "research"]);
for (const { command } of CANONICAL_COMMANDS) assert.deepEqual(summarizeCommand(command), { command, redacted: false });
for (const value of [" pnpm test", "PNPM TEST", "pnpm test --extra", "pnpm test && echo secret", "echo secret", null, 1]) {
  assert.deepEqual(summarizeCommand(value), { command: "<redacted command>", redacted: true });
}

for (const value of [null, [], "command", {}, { command: 1, redacted: false }, { command: "pnpm test", redacted: "false" }, { command: "wrong", redacted: true }, { command: "echo secret", redacted: false }, { command: "pnpm test", redacted: false, mode: "unsafe" }]) {
  const message = value === null || Array.isArray(value) || typeof value !== "object"
    ? "Command summary must be an object"
    : value.command === undefined ? "Command summary must have a string command"
      : typeof value.command !== "string" ? "Command summary must have a string command"
        : value.redacted === undefined || typeof value.redacted !== "boolean" ? "Command summary must have a boolean redacted"
          : value.redacted && value.command !== "<redacted command>" ? "Redacted command must be exactly '<redacted command>'"
            : !value.redacted && value.command !== "pnpm test" ? "Non-redacted command must be a canonical recordable command"
              : "Command mode must be a valid sandbox mode or null";
  rejected(() => validateCommandSummary(value), message);
}
validateCommandSummary({ command: "pnpm test", redacted: false });
validateCommandSummary({ command: "pnpm test", redacted: false, mode: null });
for (const mode of COMMAND_MODES) validateCommandSummary({ command: "pnpm test", redacted: false, mode });
validateCommandSummary({ command: "pnpm test", redacted: false, extra: "event layer owns this" });
rejected(() => createEvent("tool_call", { toolCallId: "tool_1", toolName: "command", summary: { command: "pnpm test", redacted: false, mode: null, extra: true } }), "Unsupported tool summary field: extra");

for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(safeCount(value), value);
for (const value of [-1, Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity, "1", 1n, true, {}, null, undefined]) assert.equal(safeCount(value), null);

assert.deepEqual(summarizeToolCall("read", { path: "src/a.ts", startLine: 1, endLine: 2 }), { path: "src/a.ts" });
assert.deepEqual(summarizeToolCall("list", { path: "src", recursive: true }), { path: "src", recursive: true });
assert.deepEqual(summarizeToolCall("grep", { pattern: "secret" }), { path: "." });
assert.deepEqual(summarizeToolCall("grep", { pattern: "secret", path: "/host" }), {});
assert.deepEqual(summarizeToolCall("write", { path: "notes.md", content: "😀" }), { path: "notes.md", bytes: 4 });
assert.deepEqual(summarizeToolCall("command", { command: "pnpm test", mode: "test" }), { command: "pnpm test", redacted: false, mode: "test" });
assert.deepEqual(summarizeToolCall("command", { command: "echo SECRET", mode: "unsafe" }), { command: "<redacted command>", redacted: true, mode: null });
assert.deepEqual(Reflect.apply(summarizeToolCall, undefined, ["read", null]), {});
assert.deepEqual(Reflect.apply(summarizeToolCall, undefined, ["list", ["private"]]), { recursive: false });
assert.deepEqual(Reflect.apply(summarizeToolCall, undefined, ["write", Object.assign(Object.create(null), { path: "null-prototype.txt", content: 1 })]), { path: "null-prototype.txt", bytes: null });
assert.deepEqual(Reflect.apply(summarizeToolCall, undefined, ["read", new (class { path = "class-instance.txt"; })()]), { path: "class-instance.txt" });
assert.deepEqual(Reflect.apply(summarizeToolCall, undefined, ["unknown", { secret: "never record" }]), {});

assert.deepEqual(summarizeToolResult("read", { path: "a.txt", content: "😀", truncated: true }), { path: "a.txt", bytes: 4, truncated: true });
assert.deepEqual(summarizeToolResult("list", { path: "src", entries: [{ name: "secret", type: "file" }] }), { path: "src", entryCount: 1 });
assert.deepEqual(summarizeToolResult("grep", { matches: [{ path: "a\\b.ts", line: 1, text: "secret" }, { path: "a/b.ts", line: 2, text: "secret" }, { path: "/host", line: 3, text: "secret" }] }), { matchCount: 3, fileCount: 1 });
const callableMatch = () => {};
callableMatch.path = "src/callable.ts";
const callableBackslashMatch = () => {};
callableBackslashMatch.path = "src\\callable.ts";
const callableWithoutPath = () => {};
const callableGrepSummary = Reflect.apply(summarizeToolResult, undefined, ["grep", { matches: [callableMatch, callableBackslashMatch, callableWithoutPath, null, undefined, 1, "private"] }]);
assert.deepEqual(callableGrepSummary, { matchCount: 7, fileCount: 1 });
assert.equal(JSON.stringify(callableGrepSummary).includes("callable"), false);
assert.deepEqual(summarizeToolResult("write", { path: "a.txt", bytes: 3 }), { path: "a.txt", bytes: 3 });
assert.deepEqual(summarizeToolResult("command", { exitCode: 7, stdout: "😀", stderr: "é", truncated: true }), { exitCode: 7, stdoutBytes: 4, stderrBytes: 2, truncated: true });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["read", null]), { bytes: 0, truncated: false });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["list", { entries: "private" }]), { entryCount: 0 });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["grep", { matches: "private" }]), { matchCount: 0, fileCount: 0 });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["grep", Object.assign(() => {}, { matches: [{ path: "src/function-result.ts" }] })]), { matchCount: 0, fileCount: 0 });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["write", { path: "a.txt", bytes: -1 }]), { path: "a.txt", bytes: null });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["command", { exitCode: 256, stdout: null, stderr: {}, truncated: 1 }]), { exitCode: null, stdoutBytes: 0, stderrBytes: 0, truncated: false });
assert.deepEqual(Reflect.apply(summarizeToolResult, undefined, ["unknown", { secret: "never record" }]), {});

console.log("All agent privacy helper checks passed.");
