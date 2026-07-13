import { deepEqual, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { AGENT_EVENT_TYPES, COMMAND_ORIGINS, PROVIDER_ATTEMPT_OUTCOMES, PROVIDER_FAILURE_OUTCOMES, RUN_TERMINALS, SANDBOX_MODES, TOOL_ERROR_MESSAGES, TOOL_NAMES } from "../lib/agent/contracts.ts";
import { buildToolProtocol, ProviderFailure } from "../lib/agent/provider.mjs";
import { PUBLIC_TOOL_ERRORS } from "../lib/agent/tool-errors.mjs";

deepEqual(TOOL_NAMES, ["read", "list", "grep", "write", "command"], "tool vocabulary remains ordered and canonical");
deepEqual(SANDBOX_MODES, ["plan", "edit", "test", "browser", "install", "research"], "sandbox vocabulary remains canonical");
deepEqual(COMMAND_ORIGINS, ["agent", "human_cli"], "command origins remain canonical");
deepEqual(PROVIDER_ATTEMPT_OUTCOMES, ["success", ...PROVIDER_FAILURE_OUTCOMES], "attempt outcomes derive from failures");
deepEqual(RUN_TERMINALS, [
  { status: "success", terminalReason: "assistant_terminal" },
  { status: "exhausted", terminalReason: "max_turns" },
  { status: "failed", terminalReason: "provider_error" },
], "run lifecycle pairs remain canonical");
deepEqual(buildToolProtocol().map((tool) => tool.name), TOOL_NAMES, "provider protocol uses canonical tool names");
deepEqual(PUBLIC_TOOL_ERRORS, TOOL_ERROR_MESSAGES, "public tool messages retain canonical JSON values");

const failure = new ProviderFailure("http_error", { httpStatus: 500, cause: "PRIVATE_CAUSE" });
deepEqual(Object.keys(failure).sort(), ["httpStatus", "outcome"], "ProviderFailure enumerable payload remains safe");
strictEqual(JSON.stringify(failure), '{"outcome":"http_error","httpStatus":500}', "ProviderFailure JSON remains unchanged");

const direct = spawnSync(process.execPath, ["--input-type=module", "--eval", 'import { TOOL_NAMES } from "./lib/agent/contracts.ts"; process.stdout.write(TOOL_NAMES.join(","));'], { cwd: process.cwd(), encoding: "utf8" });
strictEqual(direct.status, 0, "native TypeScript contracts load without a loader");
strictEqual(direct.stdout, "read,list,grep,write,command", "native TypeScript contract values execute directly");

console.log("All agent contract checks passed.");
