import { TOOL_ERROR_MESSAGES } from "./contracts.ts";

// The contracts module is the single public error vocabulary.
export const PUBLIC_TOOL_ERRORS = TOOL_ERROR_MESSAGES;

export class AgentToolError extends Error {
  constructor(code, cause) {
    const publicCode = /** @type {import("./contracts.ts").ToolErrorCode} */ (Object.hasOwn(PUBLIC_TOOL_ERRORS, code) ? code : "TOOL_EXECUTION_FAILED");
    super(PUBLIC_TOOL_ERRORS[publicCode]);
    this.name = "AgentToolError";
    this.code = publicCode;
    this.cause = cause;
  }
}

/** @param {import("./contracts.ts").ToolErrorCode} code @returns {import("./contracts.ts").PublicToolError} */
function errorFor(code) {
  switch (code) {
    case "AGENT_PATH_DENIED": return { code, message: PUBLIC_TOOL_ERRORS.AGENT_PATH_DENIED };
    case "PATH_NOT_FOUND": return { code, message: PUBLIC_TOOL_ERRORS.PATH_NOT_FOUND };
    case "NOT_A_FILE": return { code, message: PUBLIC_TOOL_ERRORS.NOT_A_FILE };
    case "NOT_A_DIRECTORY": return { code, message: PUBLIC_TOOL_ERRORS.NOT_A_DIRECTORY };
    case "INVALID_LINE_RANGE": return { code, message: PUBLIC_TOOL_ERRORS.INVALID_LINE_RANGE };
    case "INVALID_TOOL_ARGUMENTS": return { code, message: PUBLIC_TOOL_ERRORS.INVALID_TOOL_ARGUMENTS };
    case "PATH_OUTSIDE_WORKSPACE": return { code, message: PUBLIC_TOOL_ERRORS.PATH_OUTSIDE_WORKSPACE };
    default: return { code: "TOOL_EXECUTION_FAILED", message: PUBLIC_TOOL_ERRORS.TOOL_EXECUTION_FAILED };
  }
}

export function publicToolError(error) {
  if (error instanceof AgentToolError) return errorFor(error.code);
  if (error?.code === "AGENT_PATH_DENIED") return errorFor("AGENT_PATH_DENIED");
  if (error?.code === "ENOENT") return errorFor("PATH_NOT_FOUND");
  return errorFor("TOOL_EXECUTION_FAILED");
}
