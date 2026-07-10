// First OAF build-receipt emitter (issue #32).
//
// A narrow orchestration seam around the existing agent loop. It runs the loop
// with the deterministic mock provider, then aggregates the available run data
// into exactly one JSON receipt written under the generated app's
// `oaf/receipts/`. The receipt is JSON-first and machine-readable; it carries
// no Markdown, viewer, database, analytics, or real-provider accounting.
//
// Design notes:
// - It does NOT re-implement the loop, the event collector, workspace-boundary
//   checks, or tool executors. The loop runs unchanged; receipts are built
//   from its returned data, and the file is written with the existing atomic,
//   workspace-bounded `executeWrite`.
// - The receipt path is computed entirely inside this module. The model never
//   supplies or overrides it.
// - `receipt_emitted` is emitted only after the receipt is written successfully,
//   and always after the loop's `agent_end`.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvent } from "./events.mjs";
import { runAgentLoop } from "./loop.mjs";
import { executeWrite } from "./tool-execution.mjs";

export const RECEIPT_SCHEMA_VERSION = "0.1.0";
export const RECEIPT_DIR = "oaf/receipts";

// OAF factory version, read from the repo package.json (never from the model).
function resolveOafVersion() {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // Fall back to the schema version line if the repo manifest is missing.
  }
  return "0.1.0";
}

export const OAF_VERSION = resolveOafVersion();

// Commands a receipt can honestly treat as checks/tests. Matched against the
// (redacted) command string. Status comes from the tool result's exit code.
const CHECK_COMMANDS = [
  { pattern: /^pnpm test\b/, name: "test", type: "test" },
  { pattern: /^pnpm lint\b/, name: "lint", type: "lint" },
  { pattern: /^pnpm typecheck\b/, name: "typecheck", type: "typecheck" },
  { pattern: /^pnpm build\b/, name: "build", type: "build" },
  { pattern: /^git status\b/, name: "vcs-status", type: "vcs" },
  { pattern: /^git diff\b/, name: "vcs-diff", type: "vcs" },
  { pattern: /^git log\b/, name: "vcs-log", type: "vcs" },
];

// Conservative redaction for command strings. We never retain the matched
// secret; we replace it with a fixed marker and record that redaction happened.
const SECRET_PATTERNS = [
  /(\b(?:password|passwd|pwd|secret|token|apikey|api_key|accesskey|access_key|connectionstring|connection_string)\s*[=:]\s*)\S+/gi,
  /(\bBearer\s+)[A-Za-z0-9._\-]+/g,
  /([a-z][a-z0-9+.\-]*:\/\/[^\s:/]+:)[^\s@]+@/g,
];

function redactCommand(command) {
  let redacted = false;
  let value = command ?? "";
  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, (match, prefix) => {
      redacted = true;
      return `${prefix}<redacted>`;
    });
  }
  return { command: value, redacted };
}

function eventTypeSummary(events) {
  const summary = {};
  for (const event of events) {
    summary[event.type] = (summary[event.type] ?? 0) + 1;
  }
  return summary;
}

// Pull app/stack/docs-pack identity from the already-loaded OAF context
// (reusing context.documents rather than re-running boundary logic).
function extractContextMeta(context) {
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
function pairToolCalls(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.type === "tool_call") calls.set(event.toolCallId, { call: event, result: null });
    else if (event.type === "tool_result") {
      const entry = calls.get(event.toolCallId);
      if (entry) entry.result = event;
    }
  }
  return calls;
}

function buildFromTools(events) {
  const calls = pairToolCalls(events);
  const touched = [];
  const commands = [];
  let redactedCount = 0;

  for (const { call, result } of calls.values()) {
    if (call.toolName === "write" && result && !result.error) {
      const path = result.result?.path;
      if (typeof path === "string") touched.push(path);
    } else if (call.toolName === "command") {
      const args = call.args ?? {};
      const redacted = redactCommand(args.command ?? "");
      if (redacted.redacted) redactedCount++;
      let exitCode = null;
      let status = "error";
      if (result?.error) {
        status = "error";
      } else if (result?.result && typeof result.result.exitCode === "number") {
        exitCode = result.result.exitCode;
        status = exitCode === 0 ? "pass" : "fail";
      }
      commands.push({
        command: redacted.command,
        redacted: redacted.redacted,
        mode: args.mode ?? null,
        network: args.network ?? false,
        confirm: args.confirm ?? false,
        exitCode,
        status,
      });
    }
  }
  return { touched, commands, redactedCount };
}

function buildChecks(commands) {
  const checks = [];
  for (const command of commands) {
    const match = CHECK_COMMANDS.find((candidate) => candidate.pattern.test(command.command));
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

export function buildReceipt({ run, task, oafVersion = OAF_VERSION }) {
  const { appName, oafStack, docsPack } = extractContextMeta(run.context);
  const { touched, commands, redactedCount } = buildFromTools(run.events);
  const checks = buildChecks(commands);

  const succeeded = run.status === "success";
  const status = succeeded ? "success" : "failed";

  let outcome;
  if (succeeded) {
    outcome = typeof run.content === "string" && run.content.length > 0
      ? run.content
      : "Agent completed the task.";
  } else if (run.terminalReason === "max_turns") {
    outcome = "Run stopped at the maximum turn limit before reaching a terminal response.";
  } else if (run.terminalReason === "provider_error") {
    outcome = "Run failed: provider returned an invalid or missing response.";
  } else {
    outcome = "Run did not complete successfully.";
  }

  const warnings = [];
  if (!succeeded) {
    warnings.push(`Run ended with status "${run.status}" (reason: ${run.terminalReason}).`);
  }
  if (redactedCount > 0) {
    warnings.push(`Redacted secret-looking values in ${redactedCount} command argument(s).`);
  }

  const nextSteps = succeeded
    ? ["Review the generated changes and receipt.", "Run oaf doctor to confirm the app structure."]
    : ["Review the agent run events and receipt.", "Retry with an adjusted task or configuration."];

  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    id: `rcpt_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    oafVersion,
    app: { name: appName, oafStack, docsPack },
    task: { summary: task },
    runId: run.runId,
    status,
    terminalReason: run.terminalReason,
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

function receiptTimestamp() {
  // 2026-07-10T22-55-41Z — safe for filenames (no ':' or '.').
  return new Date().toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

export function receiptFileName(receipt) {
  const stamp = receiptTimestamp();
  const shortId = receipt.id.replace(/^rcpt_/, "").replace(/-/g, "").slice(0, 8);
  return `${stamp}-${shortId}.json`;
}

// Write exactly one receipt under the trusted generated-app workspace. The
// path is computed here; the model cannot influence it. The fixed receipts
// directory is created (bounded to the workspace), and the file is written with
// the existing atomic, workspace-bounded `executeWrite`, which rejects absolute
// paths, traversal, and symlink escapes. Returns the project-relative path.
export async function writeReceipt({ workspaceRoot, receipt }) {
  const dir = join(workspaceRoot, RECEIPT_DIR);
  mkdirSync(dir, { recursive: true });
  const name = receiptFileName(receipt);
  const relativePath = `${RECEIPT_DIR}/${name}`;
  const content = JSON.stringify(receipt, null, 2);
  await executeWrite({ workspaceRoot, path: relativePath, content });
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
}) {
  const run = await runAgentLoop({ task, workspaceRoot, provider, maxTurns, oafRoot, runId, commandExecutor });
  const receipt = buildReceipt({ run, task });
  const receiptPath = await writeReceipt({ workspaceRoot, receipt });
  const receiptEmitted = createEvent("receipt_emitted", {
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
