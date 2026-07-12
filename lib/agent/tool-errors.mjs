export class AgentToolError extends Error {
  constructor(code, message) { super(message); this.name = "AgentToolError"; this.code = code; }
}

export function publicToolError(error, toolName) {
  if (error?.code === "AGENT_PATH_DENIED") return { code: "AGENT_PATH_DENIED", message: "requested project path is not available to the agent" };
  if (error instanceof AgentToolError) return { code: error.code, message: error.message };
  if (error?.code === "ENOENT") {
    const messages = { read: "requested file does not exist", list: "requested directory does not exist", grep: "requested search path does not exist" };
    return { code: "PATH_NOT_FOUND", message: messages[toolName] ?? "requested path does not exist" };
  }
  return { code: "TOOL_EXECUTION_FAILED", message: "tool execution failed" };
}
