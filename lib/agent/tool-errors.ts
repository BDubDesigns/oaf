import { TOOL_ERROR_MESSAGES } from "./contracts.ts";
import type { PublicToolError, ToolErrorCode } from "./contracts.ts";

// The contracts module is the single public error vocabulary.
export const PUBLIC_TOOL_ERRORS = TOOL_ERROR_MESSAGES;

function isToolErrorCode(code: unknown): code is ToolErrorCode {
  return typeof code === "string" && Object.hasOwn(PUBLIC_TOOL_ERRORS, code);
}

export class AgentToolError extends Error {
  readonly code: ToolErrorCode;
  declare cause: unknown;

  constructor(code: ToolErrorCode, cause?: unknown) {
    const publicCode = isToolErrorCode(code) ? code : "TOOL_EXECUTION_FAILED";
    super(PUBLIC_TOOL_ERRORS[publicCode]);
    this.name = "AgentToolError";
    this.code = publicCode;
    this.cause = cause;
  }
}

function errorFor(code: ToolErrorCode): PublicToolError {
  switch (code) {
    case "AGENT_PATH_DENIED": return { code, message: PUBLIC_TOOL_ERRORS.AGENT_PATH_DENIED };
    case "PATH_NOT_FOUND": return { code, message: PUBLIC_TOOL_ERRORS.PATH_NOT_FOUND };
    case "NOT_A_FILE": return { code, message: PUBLIC_TOOL_ERRORS.NOT_A_FILE };
    case "NOT_A_DIRECTORY": return { code, message: PUBLIC_TOOL_ERRORS.NOT_A_DIRECTORY };
    case "INVALID_LINE_RANGE": return { code, message: PUBLIC_TOOL_ERRORS.INVALID_LINE_RANGE };
    case "INVALID_TOOL_ARGUMENTS": return { code, message: PUBLIC_TOOL_ERRORS.INVALID_TOOL_ARGUMENTS };
    case "PATH_OUTSIDE_WORKSPACE": return { code, message: PUBLIC_TOOL_ERRORS.PATH_OUTSIDE_WORKSPACE };
    case "TOOL_EXECUTION_FAILED": return { code, message: PUBLIC_TOOL_ERRORS.TOOL_EXECUTION_FAILED };
  }
}

function errorCode(error: unknown): string | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error) || !("code" in error) || typeof error.code !== "string") return null;
    return error.code;
  } catch {
    return null;
  }
}

export function publicToolError(error: unknown): PublicToolError {
  if (error instanceof AgentToolError) return errorFor(error.code);
  switch (errorCode(error)) {
    case "AGENT_PATH_DENIED": return errorFor("AGENT_PATH_DENIED");
    case "ENOENT": return errorFor("PATH_NOT_FOUND");
    default: return errorFor("TOOL_EXECUTION_FAILED");
  }
}
