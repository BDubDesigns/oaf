// Shared privacy helpers for durable AgentEvents and receipts. Exact provider
// conversation data stays in the loop; callers use these bounded summaries for
// audit data only.

const MAX_PATH_LENGTH = 512;
const MAX_COMMAND_LENGTH = 512;
const COMMAND_MODES = new Set(["plan", "edit", "test", "browser", "install", "research"]);
const SECRET_KEYWORDS = [
  "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
  "access_key", "accesskey", "credential", "credentials", "auth", "cookie",
  "session", "connection_string", "connectionstring", "database_url", "databaseurl",
];
const SECRET_KEYWORD_RE = new RegExp(`\\b\\w*(?:${SECRET_KEYWORDS.join("|")})\\w*\\b`, "i");

export function utf8Bytes(value) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

export function safeProjectPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH) return null;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]+/).includes("..")) return null;
  return value.replace(/\\/g, "/");
}

function commandLooksSuspicious(command) {
  if (typeof command !== "string" || command.length === 0) return false;
  const normalized = command.replace(/-/g, "_");
  return SECRET_KEYWORD_RE.test(normalized) || /authorization:/i.test(command) || /\:\/\/[^\s:/]+:[^\s@]+@/.test(command);
}

// The sole command safety policy used by both events and receipts.
export function summarizeCommand(command) {
  if (typeof command !== "string" || command.length > MAX_COMMAND_LENGTH || commandLooksSuspicious(command)) return { command: "<redacted command>", redacted: true };
  return { command: typeof command === "string" ? command : "", redacted: false };
}

function optionalPath(value) {
  const path = safeProjectPath(value);
  return path === null ? {} : { path };
}

export function summarizeToolCall(toolName, args) {
  const input = args && typeof args === "object" ? args : {};
  if (toolName === "read") return optionalPath(input.path);
  if (toolName === "list") return { ...optionalPath(input.path), recursive: input.recursive === true };
  if (toolName === "grep") return optionalPath(input.path ?? ".");
  if (toolName === "write") return { ...optionalPath(input.path), bytes: typeof input.content === "string" ? utf8Bytes(input.content) : null };
  if (toolName === "command") {
    const command = summarizeCommand(input.command);
    return {
      ...command,
      mode: COMMAND_MODES.has(input.mode) ? input.mode : null,
      network: input.network === true,
      confirm: input.confirm === true,
    };
  }
  return {};
}

export function summarizeToolResult(toolName, result) {
  const output = result && typeof result === "object" ? result : {};
  if (toolName === "read") return { ...optionalPath(output.path), bytes: utf8Bytes(output.content), truncated: output.truncated === true };
  if (toolName === "list") return { ...optionalPath(output.path), entryCount: Array.isArray(output.entries) ? output.entries.length : 0 };
  if (toolName === "grep") {
    const matches = Array.isArray(output.matches) ? output.matches : [];
    return { matchCount: matches.length, fileCount: new Set(matches.map((match) => safeProjectPath(match?.path)).filter(Boolean)).size };
  }
  if (toolName === "write") return { ...optionalPath(output.path), bytes: Number.isInteger(output.bytes) && output.bytes >= 0 ? output.bytes : null };
  if (toolName === "command") return {
    exitCode: Number.isInteger(output.exitCode) ? output.exitCode : null,
    stdoutBytes: utf8Bytes(output.stdout),
    stderrBytes: utf8Bytes(output.stderr),
    truncated: output.truncated === true,
  };
  return {};
}
