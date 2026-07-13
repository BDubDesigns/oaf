// First OAF build-receipt emitter (issue #32, hardened by #50).
//
// A narrow orchestration seam around the existing agent loop. It runs the loop
// with the deterministic mock provider, then aggregates the available run data
// into exactly one JSON receipt written under the generated app's
// `oaf/receipts/`. The receipt is JSON-first and machine-readable; it carries
// no Markdown, viewer, database, analytics, or real-provider accounting.
//
// Privacy/integrity guarantees (issue #50):
// - Raw model output is never persisted; `outcome` is a deterministic summary
//   built from trusted run facts.
// - Secret-looking values in the task and commands are redacted or omitted.
// - `receipt_emitted` is recorded as a complete AgentEvent (with seq/ts) via
//   the shared event model, only after a successful write, after `agent_end`.
// - `oafVersion` is null (with a warning) when it cannot be read/validated.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordContinuation } from "./events.ts";
import { runAgentLoop } from "./loop.ts";
import { writeWorkspaceFile } from "./tool-execution.mjs";
import { CANONICAL_COMMANDS } from "../command-policy.mjs";
import { MAX_MODEL_IDENTIFIER_LENGTH, MAX_PROVIDER_IDENTIFIER_LENGTH, normalizeProviderIdentifier } from "./provider.ts";
import { buildDiagnostic } from "./diagnostics.ts";
import {
  RECEIPT_STATUSES,
  type AgentContext,
  type AgentLoopWithReceiptOptions,
  type AgentRunWithReceiptResult,
  type BuildReceiptOptions,
  type Diagnostic,
  type Receipt,
  type ReceiptCheck,
  type ReceiptCommand,
  type ReceiptStatus,
  type ReceiptTerminal,
  type ReceiptUsage,
  type RecordedAgentEvent,
  type WriteReceiptOptions,
} from "./contracts.ts";

const [RECEIPT_SUCCESS, RECEIPT_PARTIAL, RECEIPT_FAILED] = RECEIPT_STATUSES;

export const RECEIPT_SCHEMA_VERSION = "0.1.0";
export const RECEIPT_DIR = "oaf/receipts";
export class ReceiptWriteError extends Error {
  readonly code: "RECEIPT_WRITE_FAILED";
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super("receipt could not be written");
    this.code = "RECEIPT_WRITE_FAILED";
    this.diagnostic = diagnostic;
    Object.defineProperty(this, "name", { value: "ReceiptWriteError", enumerable: false, writable: true, configurable: true });
  }
}

type ReceiptUsageFields = {
  provider: unknown;
  model: unknown;
  runMode: unknown;
  calls: unknown;
  tokensIn: unknown;
  tokensOut: unknown;
};

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasReceiptUsageFields(value: object): value is ReceiptUsageFields {
  const fields = ["provider", "model", "runMode", "calls", "tokensIn", "tokensOut"];
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

export function validateReceiptUsage(usage: unknown): ReceiptUsage {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) throw new Error("invalid receipt usage");
  if (!hasReceiptUsageFields(usage)) throw new Error("invalid receipt usage");
  const provider = normalizeProviderIdentifier(usage.provider, MAX_PROVIDER_IDENTIFIER_LENGTH);
  const model = normalizeProviderIdentifier(usage.model, MAX_MODEL_IDENTIFIER_LENGTH);
  const count = (value: unknown): value is number | null => value === null || isNonnegativeSafeInteger(value);
  if (provider === null || model === null || usage.runMode !== "agent" || !isNonnegativeSafeInteger(usage.calls) || !count(usage.tokensIn) || !count(usage.tokensOut)) throw new Error("invalid receipt usage");
  return { provider, model, runMode: "agent", calls: usage.calls, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut };
}

function isValidOafVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

// OAF factory version, read from the repo package.json (never from the model).
// If it cannot be read or is not a valid semver, we return null and let the
// receipt record `oafVersion: null` with a warning — never a fabricated value.
function resolveOafVersion(): string | null {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (isValidOafVersion(pkg.version)) return pkg.version;
  } catch {
    // Fall through to null.
  }
  return null;
}

export const OAF_VERSION = resolveOafVersion();


// Redact secret-looking values inside free text (used for the task summary).
// Assignments `NAME=value` / `NAME: value` (quoted or not), `Authorization`
// headers, and URL userinfo credentials have their secret VALUE replaced with
// `<redacted>`; surrounding structure is preserved. Returns the redacted text
// and whether any redaction occurred.
const SECRET_TEXT_NAME_PATTERN =
  "(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|accesskey|credential|credentials|auth|cookie|session|connection[_-]?string|connectionstring|database[_-]?url|databaseurl)";
const SECRET_ASSIGN_RE = new RegExp(
  `([A-Za-z0-9_-]*${SECRET_TEXT_NAME_PATTERN}[A-Za-z0-9_-]*\\s*[=:]\\s*)(?:"([^"]*)"|'([^']*)'|(\\S+))`,
  "gi",
);
const SECRET_CLI_OPTION_RE = new RegExp(
  `(--[A-Za-z0-9_-]*${SECRET_TEXT_NAME_PATTERN}[A-Za-z0-9_-]*)(=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`,
  "gi",
);

function redactSecretsInText(text: string): { text: string; redacted: boolean } {
  if (typeof text !== "string" || text.length === 0) {
    return { text: "", redacted: false };
  }
  let redacted = false;
  let value = text.replace(SECRET_ASSIGN_RE, (_match: string, prefix: string, dq: string | undefined, sq: string | undefined, _uq: string | undefined) => {
    redacted = true;
    if (dq !== undefined) return `${prefix}"<redacted>"`;
    if (sq !== undefined) return `${prefix}'<redacted>'`;
    return `${prefix}<redacted>`;
  });
  value = value.replace(SECRET_CLI_OPTION_RE, (_match: string, option: string, separator: string, dq: string | undefined, sq: string | undefined, _uq: string | undefined) => {
    redacted = true;
    if (dq !== undefined) return `${option}${separator}"<redacted>"`;
    if (sq !== undefined) return `${option}${separator}'<redacted>'`;
    return `${option}${separator}<redacted>`;
  });
  value = value.replace(/(Authorization:\s*(?:Bearer|Basic)\s+)\S+/gi, (_match: string, prefix: string) => {
    redacted = true;
    return `${prefix}<redacted>`;
  });
  value = value.replace(/([a-z][a-z0-9+.\-]*:\/\/[^\s:/]+:)[^\s@]+@/g, (_match: string, prefix: string) => {
    redacted = true;
    return `${prefix}<redacted>@`;
  });
  return { text: value, redacted };
}

function eventTypeSummary(events: RecordedAgentEvent[]): Record<RecordedAgentEvent["type"], number | undefined> {
  const summary: Record<string, number | undefined> = {};
  for (const event of events) {
    summary[event.type] = (summary[event.type] ?? 0) + 1;
  }
  return summary;
}

// Pull app/stack/docs-pack identity from the already-loaded OAF context
// (reusing context.documents rather than re-running boundary logic).
type ContextMeta = { appName: string | null; oafStack: string | null; docsPack: string | null };

function extractContextMeta(context: AgentContext): ContextMeta {
  let appName = null;
  let oafStack = context?.docsPack?.oafStack ?? null;
  let docsPack = context?.docsPack?.id ?? null;
  const appDoc = context?.documents?.find((document) => document.path === "oaf/app.json");
  if (appDoc) {
    try {
      const app = JSON.parse(appDoc.content);
      if (app && typeof app.name === "string") appName = app.name;
      if (typeof app.oafStack === "string") oafStack = app.oafStack;
    } catch {
      // Keep whatever the docsPack already told us.
    }
  }
  return { appName, oafStack, docsPack };
}

// Pair each tool_call with its tool_result by toolCallId so command outcomes
// and write results can be read without dumping the raw event stream.
type ToolCallEvent = Extract<RecordedAgentEvent, { type: "tool_call" }>;
type ToolResultEvent = Extract<RecordedAgentEvent, { type: "tool_result" }>;
type ToolCallPair = { call: ToolCallEvent; result: ToolResultEvent | null };

function pairToolCalls(events: RecordedAgentEvent[]): Map<string, ToolCallPair> {
  const calls = new Map<string, ToolCallPair>();
  for (const event of events) {
    if (event.type === "tool_call") calls.set(event.toolCallId, { call: event, result: null });
    else if (event.type === "tool_result") {
      const entry = calls.get(event.toolCallId);
      if (entry) entry.result = event;
    }
  }
  return calls;
}

function buildFromTools(events: RecordedAgentEvent[]): { touched: string[]; commands: ReceiptCommand[]; redactedCount: number; failedToolActions: number; missingToolResults: number } {
  const calls = pairToolCalls(events);
  const touched = [];
  const commands: ReceiptCommand[] = [];
  let redactedCount = 0;
  let failedToolActions = 0;
  let missingToolResults = 0;

  for (const { call, result } of calls.values()) {
    if (!result) {
      failedToolActions++;
      missingToolResults++;
    } else if (result.errorCode) {
      // Includes rejected unknown/malformed calls and argument validation
      // failures: all emit error tool_result without successful work.
      failedToolActions++;
    }

    if (call.toolName === "write" && result && !result.errorCode) {
      const path = "path" in result.summary ? result.summary.path : undefined;
      if (typeof path === "string") touched.push(path);
    } else if (call.toolName === "command") {
      const args = call.summary;
      const redacted = { command: args.command, redacted: args.redacted };
      if (redacted.redacted) redactedCount++;
      let exitCode = null;
      let status: ReceiptCommand["status"] = "error";
      if (result?.errorCode) {
        status = "error";
      } else if (result?.summary && "exitCode" in result.summary && typeof result.summary.exitCode === "number") {
        exitCode = result.summary.exitCode;
        status = exitCode === 0 ? "pass" : "fail";
      }
      commands.push({
        command: redacted.command,
        redacted: redacted.redacted,
        mode: args.mode ?? null,
        exitCode,
        status,
      });
    }
  }
  return { touched, commands, redactedCount, failedToolActions, missingToolResults };
}

function buildChecks(commands: ReceiptCommand[]): ReceiptCheck[] {
  const checks: ReceiptCheck[] = [];
  for (const command of commands) {
    const match = CANONICAL_COMMANDS.find((candidate) => candidate.command === command.command);
    if (match) {
      checks.push({
        name: match.name,
        type: match.type,
        status: command.status,
        exitCode: command.exitCode,
      });
    }
  }
  return checks;
}

// Deterministic outcome summary from trusted run facts only. Never the raw
// model output. A terminal assistant response only proves conversational
// termination; receipt status additionally reflects recorded tool/check facts.
function buildOutcome({ status, terminalReason, turns, touched, commands, checks }: { status: ReceiptStatus; terminalReason: Receipt["terminalReason"]; turns: number; touched: string[]; commands: ReceiptCommand[]; checks: ReceiptCheck[] }): string {
  const parts: string[] = [];
  if (status === RECEIPT_SUCCESS) {
    parts.push("Agent reached a terminal response with no recorded tool or check failures.");
  } else if (status === RECEIPT_PARTIAL) {
    parts.push("Agent reached a terminal response, but one or more tool actions or checks did not complete successfully.");
  } else if (terminalReason === "max_turns") {
    parts.push(`Run stopped at the maximum turn limit (${turns} turns) before a terminal response.`);
  } else if (terminalReason === "provider_error") {
    parts.push("Run failed: the provider returned an invalid or missing response.");
  } else {
    parts.push("Run did not complete successfully.");
  }
  if (touched.length > 0) {
    parts.push(`Touched ${touched.length} file(s): ${touched.join(", ")}.`);
  }
  if (commands.length > 0) {
    const failed = commands.filter((command) => command.status !== "pass").length;
    parts.push(`Ran ${commands.length} command(s); ${failed} did not pass.`);
  }
  if (checks.length > 0) {
    const failed = checks.filter((check) => check.status !== "pass").length;
    parts.push(`Checks: ${checks.length} run, ${failed} failed.`);
  }
  return parts.join(" ");
}

export function buildReceipt({ run, task, oafVersion = OAF_VERSION }: BuildReceiptOptions): Receipt {
  const { appName, oafStack, docsPack } = extractContextMeta(run.context);
  const { touched, commands, redactedCount, failedToolActions, missingToolResults } = buildFromTools(run.events);
  const checks = buildChecks(commands);

  const terminalSucceeded = run.status === "success";
  const failedCommands = commands.filter((command) => command.status !== "pass").length;
  const failedChecks = checks.filter((check) => check.status !== "pass").length;
  const partial = terminalSucceeded && (failedToolActions > 0 || failedCommands > 0 || failedChecks > 0);
  const terminal: ReceiptTerminal = terminalSucceeded
    ? { status: partial ? RECEIPT_PARTIAL : RECEIPT_SUCCESS, terminalReason: "assistant_terminal" }
    : run.terminalReason === "max_turns"
      ? { status: RECEIPT_FAILED, terminalReason: "max_turns" }
      : { status: RECEIPT_FAILED, terminalReason: "provider_error" };
  const validOafVersion = isValidOafVersion(oafVersion) ? oafVersion : null;

  const outcome = buildOutcome({ status: terminal.status, terminalReason: terminal.terminalReason, turns: run.turns, touched, commands, checks });
  const taskRedaction = redactSecretsInText(task);

  const warnings: string[] = [];
  if (partial) {
    warnings.push(
      `Partial terminal run: ${failedToolActions} failed/rejected/missing tool action(s) (${missingToolResults} missing result(s)), ${failedCommands} command(s) did not pass, ${failedChecks} check(s) did not pass.`,
    );
  } else if (!terminalSucceeded) {
    warnings.push(`Run ended with status "${run.status}" (reason: ${run.terminalReason}).`);
  }
  if (redactedCount > 0) {
    warnings.push(`Redacted secret-looking values in ${redactedCount} command argument(s).`);
  }
  if (taskRedaction.redacted) {
    warnings.push("Redacted secret-looking values in the task summary.");
  }
  if (validOafVersion == null) {
    warnings.push("oafVersion could not be determined; the receipt omits it.");
  }

  const nextSteps = terminal.status === RECEIPT_SUCCESS
    ? ["Review the generated changes and receipt.", "Run oaf doctor to confirm the app structure."]
    : ["Review the agent run events and receipt.", "Retry with an adjusted task or configuration."];

  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    id: `rcpt_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    oafVersion: validOafVersion,
    app: { name: appName, oafStack, docsPack },
    task: { summary: taskRedaction.text, redacted: taskRedaction.redacted },
    runId: run.runId,
    ...terminal,
    outcome,
    turns: run.turns,
    eventSummary: { byType: eventTypeSummary(run.events) },
    files: { created: [], touched },
    commands,
    checks,
    warnings,
    assumptions: [],
    usage: {
      model: null,
      provider: null,
      runMode: null,
      calls: null,
      tokensIn: null,
      tokensOut: null,
    },
    humanReview: { required: true, status: "pending", reviewer: null, approvedAt: null },
    nextSteps,
  };
}

function receiptTimestamp(): string {
  // 2026-07-10T22-55-41Z — safe for filenames (no ':' or '.').
  return new Date().toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

export function receiptFileName(receipt: Receipt): string {
  const stamp = receiptTimestamp();
  const shortId = receipt.id.replace(/^rcpt_/, "").replace(/-/g, "").slice(0, 8);
  return `${stamp}-${shortId}.json`;
}

// Write exactly one receipt under the trusted generated-app workspace. The
// path is computed here; the model cannot influence it. The fixed receipts
// directory is created (bounded to the workspace), and the file is written with
// the internal atomic, workspace-bounded writer, which rejects absolute
// paths, traversal, and symlink escapes. Returns the project-relative path.
export async function writeReceipt({ workspaceRoot, receipt }: WriteReceiptOptions): Promise<string> {
  const dir = join(workspaceRoot, RECEIPT_DIR);
  mkdirSync(dir, { recursive: true });
  const name = receiptFileName(receipt);
  const relativePath = `${RECEIPT_DIR}/${name}`;
  const content = JSON.stringify(receipt, null, 2);
  await writeWorkspaceFile({ workspaceRoot, path: relativePath, content });
  return relativePath;
}

// Orchestration seam: run the loop, then emit exactly one receipt. The
// `receipt_emitted` AgentEvent is produced only after a successful write and is
// appended after the loop's `agent_end`, so the ordering is unambiguous. The
// receipt does NOT embed its own creation event (no silent double-write).
export async function runAgentLoopWithReceipt({
  task,
  workspaceRoot,
  provider,
  maxTurns,
  oafRoot,
  runId,
  commandExecutor,
  receiptUsage,
}: AgentLoopWithReceiptOptions): Promise<AgentRunWithReceiptResult> {
  const run = await runAgentLoop({ task, workspaceRoot, provider, maxTurns, oafRoot, runId, commandExecutor });
  const receipt = buildReceipt({ run, task });
  if (receiptUsage !== undefined) receipt.usage = validateReceiptUsage(typeof receiptUsage === "function" ? receiptUsage(run) : receiptUsage);
  let receiptPath: string;
  try { receiptPath = await writeReceipt({ workspaceRoot, receipt }); }
  catch { throw new ReceiptWriteError(buildDiagnostic({ run, usage: receipt.usage, receiptPath: null, receiptStatus: receipt.status })); }
  // Continue the loop's recorded event stream through the shared event model so
  // receipt_emitted carries a proper seq (previous + 1) and ISO ts.
  const receiptEmitted = recordContinuation(run.events, {
    type: "receipt_emitted",
    runId: run.runId,
    receiptId: receipt.id,
    path: receiptPath,
  });
  return {
    ...run,
    receipt,
    receiptPath,
    events: [...run.events, receiptEmitted],
  };
}
