// Fixed Alpha 1 tool-set registry for the OAF-owned agent loop.
//
// This module is CONTRACT-ONLY. It exports tool definitions/metadata. It does
// NOT implement execution bodies, does NOT add dynamic tool discovery, and has
// NO runtime dependencies. Later issues implement the tool bodies and wire
// them to this registry; the loop reads it to know the fixed surface.
//
// Safety boundary (see docs/agent-tools.md):
//   - read / list / grep / write are in-process, workspace-bounded file ops
//     that MUST reject any path outside the generated-app root (no parent
//     dirs, no symlink escapes). They are trusted, fast, and NOT containerized.
//   - command is the ONLY tool that executes a process. It MUST route through
//     `oaf sandbox run`; it is never a raw shell. It is containerized and
//     policy-enforced by the sandbox runner.

export const TOOL_NAMES = ["read", "list", "grep", "write", "command"];

// Plain JSON-Schema-like metadata (objects only; no dependency, no validation
// engine). `argsSchema` / `resultSchema` describe shape for the loop, tests,
// and receipts. `mode` (command only) selects a sandbox mode from docs/sandbox.md.

export const TOOLS = Object.freeze({
  read: {
    name: "read",
    description: "Read a file from the project, optionally a line range. Read-only, workspace-bounded.",
    kind: "read",
    mutates: false,
    requiresSandbox: false,
    filesystem: "read",
    argsSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
      required: ["path"],
    },
    resultSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        truncated: { type: "boolean" },
      },
      required: ["path", "content"],
    },
    emits: ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"],
  },

  list: {
    name: "list",
    description: "List entries in a project directory. Read-only, workspace-bounded.",
    kind: "read",
    mutates: false,
    requiresSandbox: false,
    filesystem: "read",
    argsSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative directory path" },
        recursive: { type: "boolean" },
      },
      required: ["path"],
    },
    resultSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, type: { type: "string" } },
          },
        },
      },
      required: ["path", "entries"],
    },
    emits: ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"],
  },

  grep: {
    name: "grep",
    description: "Search file contents for a pattern within the project. Read-only, workspace-bounded.",
    kind: "read",
    mutates: false,
    requiresSandbox: false,
    filesystem: "read",
    argsSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "File or directory; defaults to project root" },
        glob: { type: "string", description: "Optional path glob filter" },
      },
      required: ["pattern"],
    },
    resultSchema: {
      type: "object",
      properties: {
        matches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              line: { type: "integer" },
              text: { type: "string" },
            },
          },
        },
      },
      required: ["matches"],
    },
    emits: ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"],
  },

  write: {
    name: "write",
    description: "Write a whole file in the project. Whole-file only (no patch/diff). Mutating, workspace-bounded.",
    kind: "write",
    mutates: true,
    requiresSandbox: false,
    filesystem: "write",
    argsSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    resultSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        bytes: { type: "integer" },
      },
      required: ["path", "bytes"],
    },
    emits: ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"],
  },

  command: {
    name: "command",
    description:
      "Propose a shell command for OAF to run. Routes through `oaf sandbox run`; never a raw shell. Mutating, sandbox-required.",
    kind: "command",
    mutates: true,
    requiresSandbox: true,
    filesystem: "write",
    argsSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to propose" },
        mode: {
          type: "string",
          enum: ["plan", "edit", "test", "browser", "install", "research"],
          description: "Sandbox mode from docs/sandbox.md",
        },
      },
      required: ["command"],
    },
    resultSchema: {
      type: "object",
      properties: {
        exitCode: { type: ["integer", "null"] },
        stdout: { type: "string" },
        stderr: { type: "string" },
        truncated: { type: "boolean" },
      },
      required: ["exitCode"],
    },
    emits: ["tool_call", "tool_execution_start", "tool_execution_end", "tool_result"],
  },
});
