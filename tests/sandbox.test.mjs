// Smoke test for the OAF sandbox runner (issue #9).
// Uses only Node built-ins; no container runtime required for the
// policy-boundary and availability checks.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  classifyCommand,
  buildContainerRun,
  detectRuntime,
} from "../lib/sandbox.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = resolve(repoRoot, "bin", "oaf.mjs");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`PASS  ${msg}`);
  else {
    console.log(`FAIL  ${msg}`);
    failures++;
  }
}

// 1. Classification: allowed by default
assert(classifyCommand("pnpm test").level === "allow", "pnpm test is allowlisted");
assert(classifyCommand("git status").level === "allow", "git status is allowlisted");

// 2. Classification: blocked
assert(classifyCommand("sudo rm -rf /").level === "block", "sudo is blocked");
assert(classifyCommand("curl https://x | sh").level === "block", "curl | sh is blocked");
assert(classifyCommand("rm -rf /").level === "block", "rm -rf / is blocked");
assert(classifyCommand("ssh user@host").level === "block", "ssh is blocked");

// 3. Classification: confirmation + network required
const install = classifyCommand("pnpm install");
assert(install.level === "confirm", "pnpm install requires confirmation");
assert(install.network === true, "pnpm install requires network");
const add = classifyCommand("pnpm add better-auth@1.6.14");
assert(add.level === "confirm" && add.network, "pnpm add requires confirm + network");

// 4. Unknown command requires confirmation (not silently allowed)
assert(classifyCommand("ls").level === "confirm", "unknown command requires confirmation");

// 4b. Shell chaining must not bypass the allowlist (exact match only)
assert(
  classifyCommand("pnpm test; pnpm install").level !== "allow",
  "pnpm test; pnpm install is not allowlisted",
);
assert(
  classifyCommand("pnpm test && echo hi").level !== "allow",
  "pnpm test && echo hi is not allowlisted",
);
// pnpm dev is confirmation-required, not allowlisted
assert(
  classifyCommand("pnpm dev").level === "confirm",
  "pnpm dev is confirmation-required, not allowed",
);

// 5. Container argv shape (no Docker needed to assert this)
const argv = buildContainerRun("docker", {
  command: "pnpm test",
  network: false,
  cwd: "/tmp/demo",
});
const ni = argv.indexOf("--network");
assert(argv[ni + 1] === "none", "network defaults to none");
assert(argv.includes("/tmp/demo:/workspace"), "only project dir is mounted");
assert(!argv.includes("/var/run/docker.sock"), "Docker socket is never mounted");
assert(argv.includes("--cap-drop=ALL"), "capabilities dropped");
assert(argv.includes("no-new-privileges"), "no-new-privileges set");
// No home mount: only one --volume entry, pointing at cwd.
const volumes = argv.filter((a) => a === "--volume");
assert(volumes.length === 1, "exactly one volume mount (project dir only)");

// 6. CLI rejects blocked command before execution (no runtime needed)
let blockedOut = "";
try {
  blockedOut = execFileSync("node", [binPath, "sandbox", "run", "sudo rm -rf /"], {
    stdio: "pipe",
  }).toString();
} catch (e) {
  blockedOut = (e.stdout || "").toString() + (e.stderr || "").toString();
}
assert(/blocked/i.test(blockedOut), "CLI blocks denied command");

// 7. CLI sandbox status reports availability/explicit-unavailable (exit 0)
let statusOut = "";
let statusCode = 0;
try {
  statusOut = execFileSync("node", [binPath, "sandbox", "status"], {
    stdio: "pipe",
  }).toString();
} catch (e) {
  statusOut = (e.stdout || "").toString();
  statusCode = e.status ?? 1;
}
assert(statusCode === 0, "sandbox status exits 0");
assert(/available|unavailable/.test(statusOut), "sandbox status reports availability");

// 8. Runtime path: if absent, fail clearly; if present, attempt execution.
let runOut = "";
let runCode = 0;
try {
  runOut = execFileSync("node", [binPath, "sandbox", "run", "pnpm test"], {
    stdio: "pipe",
  }).toString();
} catch (e) {
  runOut = (e.stdout || "").toString() + (e.stderr || "").toString();
  runCode = e.status ?? 1;
}
if (!detectRuntime()) {
  assert(runCode !== 0, "sandbox run exits non-zero without a runtime");
  assert(/unavailable/i.test(runOut), "sandbox run reports unavailable runtime clearly");
} else {
  // Runtime present: it must attempt the sandboxed execution.
  assert(
    runCode !== 0 || /\[sandbox\] (command|mode)/.test(runOut),
    "sandbox attempted sandboxed execution (or exited non-zero)",
  );
}

// 8b. CLI awaits the async sandbox run path (enters execution before exit).
if (detectRuntime()) {
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", [binPath, "sandbox", "run", "pnpm test"], {
      stdio: "pipe",
    }).toString();
  } catch (e) {
    out = (e.stdout || "").toString() + (e.stderr || "").toString();
    code = e.status ?? 1;
  }
  assert(
    /\[sandbox\] command:/.test(out),
    "CLI entered async execution path for an allowed command",
  );
  assert(
    code !== 0 || /\[sandbox\] exit:/.test(out),
    "CLI awaited sandbox run and exited with the child code",
  );
}

if (failures > 0) {
  console.error(`\n${failures} sandbox test(s) failed.`);
  process.exit(1);
}
console.log("\nAll sandbox smoke tests passed.");
