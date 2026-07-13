// Focused test for the fixed Alpha 1 tool-set registry.
// Uses only Node built-ins; no third-party dependencies.
import { strictEqual, deepEqual, ok, throws, doesNotThrow } from "node:assert";
import { getToolDefinition, TOOLS, TOOL_NAMES } from "../lib/agent/tools.ts";

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS  ${msg}`);
  } else {
    console.log(`FAIL  ${msg}`);
    failures++;
  }
}

// 1. registry exports the expected fixed tool names (no discovery)
const EXPECTED = ["read", "list", "grep", "write", "command"];
deepEqual(TOOL_NAMES, EXPECTED, "registry exports exactly the 5 fixed tools");
deepEqual(Object.keys(TOOLS), EXPECTED, "TOOLS keys match the fixed set");

// 2. no dynamic discovery / unknown registration
ok(Object.isFrozen(TOOLS), "TOOLS registry is frozen (no mutation at runtime)");
assert(
  !("register" in TOOLS) && !("add" in TOOLS),
  "registry exposes no register/add (no dynamic discovery)",
);
assert(
  !("register" in TOOLS) && !("define" in TOOLS),
  "registry has no registration surface",
);

// 3. every tool has required metadata
const KINDS = ["read", "write", "command"];
const FS = ["read", "write"];
for (const name of EXPECTED) {
  const t = getToolDefinition(name);
  if (!t) {
    assert(false, `tool defined: ${name}`);
    continue;
  }
  assert(true, `tool defined: ${name}`);
  strictEqual(t.name, name, `${name}.name matches key`);
  assert(typeof t.description === "string" && t.description.length > 0, `${name}.description is a non-empty string`);
  assert(KINDS.includes(t.kind), `${name}.kind is valid (${t.kind})`);
  assert(typeof t.mutates === "boolean", `${name}.mutates is boolean`);
  assert(typeof t.requiresSandbox === "boolean", `${name}.requiresSandbox is boolean`);
  assert(FS.includes(t.filesystem), `${name}.filesystem valid (${t.filesystem})`);
  assert(typeof t.argsSchema === "object" && t.argsSchema !== null, `${name}.argsSchema is a plain object`);
  assert(typeof t.resultSchema === "object" && t.resultSchema !== null, `${name}.resultSchema is a plain object`);
  assert(Array.isArray(t.emits) && t.emits.length > 0, `${name}.emits lists event types`);
}

// 4. command tool routes through the sandbox
strictEqual(TOOLS.command.requiresSandbox, true, "command requires sandbox");
assert("mode" in TOOLS.command.argsSchema.properties, "command args declare a sandbox mode");

// 5. read/list/grep are non-mutating
for (const name of ["read", "list", "grep"]) {
  const tool = getToolDefinition(name);
  strictEqual(tool?.mutates, false, `${name} is non-mutating`);
  strictEqual(tool?.requiresSandbox, false, `${name} does not require sandbox`);
}

// 6. write is mutating
strictEqual(TOOLS.write.mutates, true, "write is mutating");
strictEqual(TOOLS.write.filesystem, "write", "write touches the filesystem");

// 7. schemas are plain objects and JSON-serializable
let serialized;
doesNotThrow(() => {
  serialized = JSON.parse(JSON.stringify(TOOLS));
}, "registry is JSON-serializable");
strictEqual(serialized.command.requiresSandbox, true, "serialized registry keeps metadata");
strictEqual(typeof serialized.read.argsSchema, "object", "serialized argsSchema stays an object");

// 8. mutating tools are exactly write + command
const mutating = EXPECTED.filter((name) => getToolDefinition(name)?.mutates);
deepEqual(mutating, ["write", "command"], "only write and command mutate");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent-tools checks passed.");
