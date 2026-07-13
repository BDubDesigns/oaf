// Fixed Alpha 1 tool-set registry for the OAF-owned agent loop.
// This module is metadata-only: command execution always routes through the sandbox.

import { TOOL_NAMES as TOOL_NAME_VALUES, type ToolRegistry } from "./contracts.ts";

export const TOOL_NAMES = TOOL_NAME_VALUES;

function definition<Name extends import("./contracts.ts").ToolName>(name: Name, description: string, kind: "read" | "write" | "command", mutates: boolean, requiresSandbox: boolean, filesystem: "read" | "write", required: string[], properties: Record<string, import("./contracts.ts").JsonSchema>, resultRequired: string[], resultProperties: Record<string, import("./contracts.ts").JsonSchema>): import("./contracts.ts").ToolDefinition<Name> {
  return { name, description, kind, mutates, requiresSandbox, filesystem, argsSchema: { type: "object", properties, required }, resultSchema: { type: "object", properties: resultProperties, required: resultRequired }, emits: ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"] as const };
}

const REGISTRY = {
  read: definition("read", "Read a file from the project, optionally a line range. Read-only, workspace-bounded.", "read", false, false, "read", ["path"], { path: { type: "string", description: "Project-relative file path" }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, ["path", "content"], { path: { type: "string" }, content: { type: "string" }, truncated: { type: "boolean" } }),
  list: definition("list", "List entries in a project directory. Read-only, workspace-bounded.", "read", false, false, "read", ["path"], { path: { type: "string", description: "Project-relative directory path" }, recursive: { type: "boolean" } }, ["path", "entries"], { path: { type: "string" }, entries: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string" } } } } }),
  grep: definition("grep", "Search file contents for a pattern within the project. Read-only, workspace-bounded.", "read", false, false, "read", ["pattern"], { pattern: { type: "string" }, path: { type: "string", description: "File or directory; defaults to project root" }, glob: { type: "string", description: "Optional path glob filter" } }, ["matches"], { matches: { type: "array", items: { type: "object", properties: { path: { type: "string" }, line: { type: "integer" }, text: { type: "string" } } } } }),
  write: definition("write", "Write a whole file in the project. Whole-file only (no patch/diff). Mutating, workspace-bounded.", "write", true, false, "write", ["path", "content"], { path: { type: "string", description: "Project-relative file path" }, content: { type: "string" } }, ["path", "bytes"], { path: { type: "string" }, bytes: { type: "integer" } }),
  command: definition("command", "Propose a shell command for OAF to run. Routes through `oaf sandbox run`; never a raw shell. Mutating, sandbox-required.", "command", true, true, "write", ["command"], { command: { type: "string", description: "Shell command to propose" }, mode: { type: "string", enum: ["plan", "edit", "test", "browser", "install", "research"], description: "Sandbox mode from docs/sandbox.md" } }, ["exitCode"], { exitCode: { type: ["integer", "null"] }, stdout: { type: "string" }, stderr: { type: "string" }, truncated: { type: "boolean" } }),
} as const satisfies ToolRegistry;

// JavaScript consumers intentionally retain the registry's existing dynamic
// lookup behavior; REGISTRY above is the checked source of truth.
export const TOOLS = Object.freeze(REGISTRY) as Readonly<Record<string, any>>;
