// Alpha 1 provider-data visibility policy. This is path-based protection, not
// general secret detection in ordinary source files.
const SECRET_BASENAMES = new Set([".npmrc", ".netrc", ".git-credentials", "id_rsa", "id_ed25519"]);
const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const PROTECTED_SEGMENTS = new Set([".git", ".ssh", "node_modules"]);

export const AGENT_PATH_DENIED_MESSAGE = "requested project path is not available to the agent";

export class AgentPathDeniedError extends Error {
  readonly code: "AGENT_PATH_DENIED";

  constructor() {
    super(AGENT_PATH_DENIED_MESSAGE);
    this.name = "AGENT_PATH_DENIED";
    this.code = "AGENT_PATH_DENIED";
  }
}

function parts(path: string): string[] {
  return String(path).replaceAll("\\", "/").split("/").filter(Boolean);
}

export function isProtectedAgentPath(path: string): boolean {
  const segments = parts(path);
  const name = (segments.at(-1) ?? "").toLowerCase();
  return name.startsWith(".env")
    || SECRET_BASENAMES.has(name)
    || [...SECRET_EXTENSIONS].some((extension) => name.endsWith(extension))
    || segments.some((segment) => PROTECTED_SEGMENTS.has(segment.toLowerCase()))
    || (segments[0] === "oaf" && segments[1] === "receipts");
}

export function isAgentReadablePath(path: string): boolean {
  return !isProtectedAgentPath(path);
}

export function isAgentWritablePath(path: string): boolean {
  return !isProtectedAgentPath(path) && parts(path)[0] !== "oaf";
}

export function shouldHideFromAgentTraversal(path: string): boolean {
  return isProtectedAgentPath(path);
}

export function assertAgentReadablePath(...paths: string[]): void {
  if (paths.some(isProtectedAgentPath)) throw new AgentPathDeniedError();
}

export function assertAgentWritablePath(...paths: string[]): void {
  if (paths.some((path) => !isAgentWritablePath(path))) throw new AgentPathDeniedError();
}
