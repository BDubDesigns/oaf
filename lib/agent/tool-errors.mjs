export const PUBLIC_TOOL_ERRORS = Object.freeze({
  AGENT_PATH_DENIED: "requested project path is not available to the agent",
  PATH_NOT_FOUND: "requested path does not exist",
  NOT_A_FILE: "requested path is not a file",
  NOT_A_DIRECTORY: "requested path is not a directory",
  INVALID_LINE_RANGE: "requested line range is invalid",
  INVALID_TOOL_ARGUMENTS: "tool arguments are invalid",
  PATH_OUTSIDE_WORKSPACE: "requested path is outside the workspace",
  TOOL_EXECUTION_FAILED: "tool execution failed",
});

export class AgentToolError extends Error {
  constructor(code, cause) {
    const publicCode = Object.hasOwn(PUBLIC_TOOL_ERRORS, code) ? code : "TOOL_EXECUTION_FAILED";
    super(PUBLIC_TOOL_ERRORS[publicCode]);
    this.name = "AgentToolError";
    this.code = publicCode;
    this.cause = cause;
  }
}

export function publicToolError(error) {
  if (error instanceof AgentToolError) return { code: error.code, message: PUBLIC_TOOL_ERRORS[error.code] };
  if (error?.code === "AGENT_PATH_DENIED") return { code: "AGENT_PATH_DENIED", message: PUBLIC_TOOL_ERRORS.AGENT_PATH_DENIED };
  if (error?.code === "ENOENT") return { code: "PATH_NOT_FOUND", message: PUBLIC_TOOL_ERRORS.PATH_NOT_FOUND };
  return { code: "TOOL_EXECUTION_FAILED", message: PUBLIC_TOOL_ERRORS.TOOL_EXECUTION_FAILED };
}
