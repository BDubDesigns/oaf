import { TOOL_ERROR_MESSAGES } from "./contracts.ts";

/** @typedef {import("./contracts.ts").PublicToolError} PublicToolError */

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

export function publicToolError(error) {
  if (error instanceof AgentToolError) return { code: error.code, message: PUBLIC_TOOL_ERRORS[error.code] };
  if (error?.code === "AGENT_PATH_DENIED") return { code: "AGENT_PATH_DENIED", message: PUBLIC_TOOL_ERRORS.AGENT_PATH_DENIED };
  if (error?.code === "ENOENT") return { code: "PATH_NOT_FOUND", message: PUBLIC_TOOL_ERRORS.PATH_NOT_FOUND };
  return { code: "TOOL_EXECUTION_FAILED", message: PUBLIC_TOOL_ERRORS.TOOL_EXECUTION_FAILED };
}
