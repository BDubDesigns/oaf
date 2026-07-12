import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildDiagnostic, writeDiagnostic } from "../lib/agent/diagnostics.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(ok, message) { if (ok) console.log(`PASS  ${message}`); else { console.log(`FAIL  ${message}`); failures++; } }
const fixture = copyGeneratedAppFixture();
try {
  const raw = "API_KEY_SENTINEL AUTHORIZATION http://127.0.0.1/abs TASK_SENTINEL RAW_RESPONSE MODEL_OUTPUT";
  const run = { runId: "run_diag", status: "failed", terminalReason: "provider_error", turns: 1, providerAttempts: [{ turn: 1, durationMs: 3, outcome: "rate_limited", httpStatus: 429 }], events: [{ type: "tool_call", toolCallId: "tool_1_1", toolName: "read", summary: { path: "README.md" } }, { type: "tool_execution_end", toolCallId: "tool_1_1", success: false }, { type: "tool_result", toolCallId: "tool_1_1", errorCode: "execution_error", summary: {} }] };
  assert(!existsSync(join(fixture.workspace, "oaf/diagnostics")), "diagnostics disabled writes nothing");
  const path = await writeDiagnostic({ workspaceRoot: fixture.workspace, diagnostic: buildDiagnostic({ run, usage: { provider: "openai-compatible", model: "test/model" }, receiptPath: "oaf/receipts/a.json" }) });
  const text = readFileSync(join(fixture.workspace, path), "utf8");
  assert(path.startsWith("oaf/diagnostics/") && readdirSync(join(fixture.workspace, "oaf/diagnostics")).length === 1, "enabled diagnostics writes exactly one project-relative file");
  assert(!text.includes(raw) && !text.includes("README.md") && text.includes("execution_error") && text.includes("rate_limited") && text.includes("429"), "diagnostic uses allowlisted recorded provider and tool fields only");
} finally { fixture.cleanup(); }
if (failures) process.exit(1);
console.log("All agent diagnostics checks passed.");
