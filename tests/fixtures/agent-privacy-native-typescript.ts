import {
  safeCount,
  safeProjectPath,
  summarizeCommand,
  summarizeToolCall,
  summarizeToolResult,
  utf8Bytes,
} from "../../lib/agent/privacy.ts";
import type { SandboxMode, ToolResultSummary } from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type BytesAcceptUnknown = Assert<Equal<typeof utf8Bytes, (value: unknown) => number>>;
type PathAcceptUnknown = Assert<Equal<typeof safeProjectPath, (value: unknown) => string | null>>;
type CountAcceptUnknown = Assert<Equal<typeof safeCount, (value: unknown) => number | null>>;

const readCall = summarizeToolCall("read", { path: "README.md" });
const listCall = summarizeToolCall("list", { path: "docs", recursive: true });
const grepCall = summarizeToolCall("grep", { pattern: "private", path: "src" });
const writeCall = summarizeToolCall("write", { path: "notes.md", content: "private body" });
const commandCall = summarizeToolCall("command", { command: "pnpm test", mode: "test" });
const readResult = summarizeToolResult("read", { path: "README.md", content: "private", truncated: false });
const listResult = summarizeToolResult("list", { path: "docs", entries: [{ name: "private", type: "file" }] });
const grepResult = summarizeToolResult("grep", { matches: [{ path: "src/a.ts", line: 1, text: "private" }] });
const commandResult = summarizeToolResult("command", { exitCode: 0, stdout: "private", stderr: "private", truncated: false });
const commandSummary = summarizeCommand("pnpm test");
const redactedSummary = summarizeCommand("echo private");

const mode: SandboxMode | null = commandCall.mode;
const nullableWriteBytes: number | null = writeCall.bytes;
const nullableExitCode: number | null = commandResult.exitCode;
const strictResult: ToolResultSummary["write"] = { path: "notes.md", bytes: 1 };

if (false) {
  // @ts-expect-error Arbitrary tool names cannot enter normal calls.
  summarizeToolCall("shell", { command: "pnpm test" });
  // @ts-expect-error Read summaries never expose raw content.
  readCall.content;
  // @ts-expect-error Grep summaries never expose search patterns.
  grepCall.pattern;
  // @ts-expect-error Result summaries never expose read content.
  readResult.content;
  // @ts-expect-error Result summaries never expose list entries.
  listResult.entries;
  // @ts-expect-error Result summaries never expose grep text.
  grepResult.text;
  // @ts-expect-error Result summaries never expose stdout.
  commandResult.stdout;
  // @ts-expect-error A redaction marker cannot be paired with false.
  const invalidRedaction: typeof commandSummary = { command: "<redacted command>", redacted: false };
  // @ts-expect-error Malformed candidate nulls cannot satisfy strict successful result contracts.
  const invalidSuccessfulResult: ToolResultSummary["command"] = commandResult;
  // @ts-expect-error Command modes remain bounded to the sandbox vocabulary.
  const invalidMode: SandboxMode | null = "unsafe";
  void [invalidRedaction, invalidSuccessfulResult, invalidMode];
}

const proof: [BytesAcceptUnknown, PathAcceptUnknown, CountAcceptUnknown] = [true, true, true];
void [proof, listCall, writeCall, commandCall, redactedSummary, mode, nullableWriteBytes, nullableExitCode, strictResult];
process.stdout.write("agent-privacy-native-typescript:ok");
