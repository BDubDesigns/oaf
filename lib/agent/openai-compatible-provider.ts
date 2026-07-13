import { type JsonObject, type NormalizedProviderRequest, type NormalizedProviderResponse, type Provider, type ToolErrorCode } from "./contracts.ts";
import { MAX_MODEL_IDENTIFIER_LENGTH, normalizeProviderIdentifier, ProviderFailure, validateProviderCall } from "./provider.ts";
import { PUBLIC_TOOL_ERRORS } from "./tool-errors.mjs";

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
export const MAX_BODY_BYTES = 1_048_576;
const SUPPORTED_FINISH_REASONS = new Set(["stop", "tool_calls"]);
const TOOL_ERROR_CODES = new Set<string>(Object.keys(PUBLIC_TOOL_ERRORS));

export interface ProviderTransportRequest { url: string; method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal; }
export interface ProviderTransportResponse { status: number; body: string | null; }
export type ProviderTransport = (input: ProviderTransportRequest) => Promise<ProviderTransportResponse>;
export interface OpenAICompatibleProviderOptions { baseUrl?: string; model?: string; apiKeyEnv?: string; env?: Readonly<Record<string, string | undefined>>; transport?: ProviderTransport; timeoutMs?: number; }
export interface OpenAICompatibleProvider extends Provider { complete(request: NormalizedProviderRequest): Promise<NormalizedProviderResponse>; }

interface OpenAIMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string; }
interface OpenAITool { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> }; }

function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function isPlainObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isJsonObject(value: unknown): value is JsonObject {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isJsonValue);
}
function isJsonValue(value: unknown): value is import("./contracts.ts").JsonValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value) && value.every(isJsonValue) || isJsonObject(value);
}
function isToolErrorCode(value: unknown): value is ToolErrorCode { return typeof value === "string" && TOOL_ERROR_CODES.has(value); }

function outcomeFromStatus(status: number): "authentication_failed" | "not_found" | "rate_limited" | "http_error" {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "http_error";
}
function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`OpenAI-compatible provider requires a non-empty ${label}.`);
  return value;
}
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function normalizeEndpoint(baseUrl: unknown): string {
  const value = requireNonEmptyString(baseUrl, "base URL");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("OpenAI-compatible provider base URL must be an absolute HTTP or HTTPS URL."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("OpenAI-compatible provider base URL must use HTTP or HTTPS.");
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) throw new Error("OpenAI-compatible provider permits plain HTTP only for loopback development addresses.");
  if (parsed.username || parsed.password) throw new Error("OpenAI-compatible provider base URL must not include credentials.");
  if (parsed.search || parsed.hash) throw new Error("OpenAI-compatible provider base URL must not include a query string or fragment.");
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  return normalized.endsWith(CHAT_COMPLETIONS_PATH) ? normalized : `${normalized}${CHAT_COMPLETIONS_PATH}`;
}
function validateTimeout(timeoutMs: unknown): number {
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new Error(`OpenAI-compatible provider timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  return timeoutMs;
}
function validateApiKeyEnv(apiKeyEnv: unknown, env: Readonly<Record<string, string | undefined>>): string {
  requireNonEmptyString(apiKeyEnv, "API-key environment-variable name");
  if (typeof apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error("OpenAI-compatible provider API-key environment-variable name is invalid.");
  const apiKey = env[apiKeyEnv];
  if (typeof apiKey !== "string" || apiKey.length === 0) throw new Error(`OpenAI-compatible provider requires a non-empty value in environment variable ${apiKeyEnv}.`);
  return apiKey;
}

function translateToolCall(call: unknown): { id: string; type: "function"; function: { name: string; arguments: string } } {
  if (!isPlainObject(call) || typeof call.id !== "string" || call.id.length === 0 || typeof call.name !== "string" || call.name.length === 0 || !isPlainObject(call.args)) throw new ProviderFailure("invalid_response");
  return { id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } };
}
function translateMessages(request: unknown): OpenAIMessage[] {
  if (!isPlainObject(request) || typeof request.system !== "string" || !Array.isArray(request.messages)) throw new ProviderFailure("invalid_response");
  const messages: OpenAIMessage[] = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (!isPlainObject(message)) throw new ProviderFailure("invalid_response");
    if (message.role === "user") {
      if (typeof message.content !== "string") throw new ProviderFailure("invalid_response");
      messages.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      if (message.content !== null && message.content !== undefined && typeof message.content !== "string") throw new ProviderFailure("invalid_response");
      const translated: OpenAIMessage = { role: "assistant", content: typeof message.content === "string" ? message.content : null };
      if (message.toolCalls !== undefined) {
        if (!Array.isArray(message.toolCalls)) throw new ProviderFailure("invalid_response");
        translated.tool_calls = message.toolCalls.map(translateToolCall);
      }
      messages.push(translated);
    } else if (message.role === "tool") {
      if (!Array.isArray(message.toolResults)) throw new ProviderFailure("invalid_response");
      for (const result of message.toolResults) {
        if (!isPlainObject(result) || typeof result.toolCallId !== "string" || result.toolCallId.length === 0) throw new ProviderFailure("invalid_response");
        const code = isToolErrorCode(result.errorCode) ? result.errorCode : "TOOL_EXECUTION_FAILED";
        const content = Object.hasOwn(result, "error") ? JSON.stringify({ code, error: PUBLIC_TOOL_ERRORS[code] }) : JSON.stringify(Object.hasOwn(result, "result") ? result.result : null);
        messages.push({ role: "tool", tool_call_id: result.toolCallId, content });
      }
    } else throw new ProviderFailure("invalid_response");
  }
  return messages;
}
function translateTools(tools: unknown): OpenAITool[] {
  if (!Array.isArray(tools)) throw new ProviderFailure("invalid_response");
  return tools.map((tool) => {
    if (!isPlainObject(tool) || typeof tool.name !== "string" || tool.name.length === 0 || typeof tool.description !== "string" || !isPlainObject(tool.argsSchema)) throw new ProviderFailure("invalid_response");
    return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.argsSchema } };
  });
}
function translateUsage(usage: unknown): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } {
  const value = (field: string): number | null => {
    if (!isPlainObject(usage)) return null;
    const candidate = usage[field];
    return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 ? candidate : null;
  };
  return { inputTokens: value("prompt_tokens"), outputTokens: value("completion_tokens"), totalTokens: value("total_tokens") };
}
function sanitizeReportedModel(payload: Record<string, unknown>, apiKey: string): string | null {
  if (typeof payload.model !== "string") return null;
  const trimmed = payload.model.trim();
  if (apiKey && trimmed.includes(apiKey)) return null;
  return normalizeProviderIdentifier(trimmed, MAX_MODEL_IDENTIFIER_LENGTH);
}
function normalizeConfiguredModel(model: unknown): string {
  const normalized = normalizeProviderIdentifier(model, MAX_MODEL_IDENTIFIER_LENGTH);
  if (normalized === null) throw new Error("OpenAI-compatible provider requires a valid model ID.");
  return normalized;
}
function translateToolCalls(message: Record<string, unknown>): { id: string; name: string; args: JsonObject }[] {
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw new ProviderFailure("invalid_response");
  const seenIds = new Set<string>();
  return (message.tool_calls ?? []).map((call) => {
    if (!isPlainObject(call) || call.type !== "function" || !isPlainObject(call.function) || typeof call.id !== "string" || call.id.trim().length === 0 || typeof call.function.name !== "string" || call.function.name.trim().length === 0 || typeof call.function.arguments !== "string") throw new ProviderFailure("invalid_response");
    if (seenIds.has(call.id)) throw new ProviderFailure("invalid_response");
    seenIds.add(call.id);
    let args: unknown;
    try { args = JSON.parse(call.function.arguments); } catch { throw new ProviderFailure("invalid_response"); }
    if (!isJsonObject(args)) throw new ProviderFailure("invalid_response");
    return { id: call.id, name: call.function.name, args };
  });
}
function validateCompletion(message: Record<string, unknown>, toolCalls: { id: string; name: string; args: JsonObject }[], finishReason: unknown): void {
  if (typeof message.refusal === "string" && message.refusal.trim().length > 0) throw new ProviderFailure("invalid_response");
  if (finishReason === "length" || finishReason === "content_filter" || typeof finishReason !== "string" || !SUPPORTED_FINISH_REASONS.has(finishReason)) throw new ProviderFailure("invalid_response");
  if (finishReason === "tool_calls") { if (toolCalls.length === 0) throw new ProviderFailure("invalid_response"); return; }
  if (toolCalls.length > 0 || typeof message.content !== "string" || message.content.trim().length === 0) throw new ProviderFailure("invalid_response");
}
function translateResponse(payload: unknown, configuredModel: string, apiKey: string): NormalizedProviderResponse {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) throw new ProviderFailure("invalid_response");
  const choice = payload.choices[0];
  const message = isPlainObject(choice) && isPlainObject(choice.message) ? choice.message : null;
  if (message === null || message.role !== "assistant") throw new ProviderFailure("invalid_response");
  const content = message.content;
  if (content !== null && typeof content !== "string") throw new ProviderFailure("invalid_response");
  const toolCalls = translateToolCalls(message);
  validateCompletion(message, toolCalls, isPlainObject(choice) ? choice.finish_reason : undefined);
  return { content, toolCalls, providerCall: { provider: "openai-compatible", requestedModel: configuredModel, reportedModel: sanitizeReportedModel(payload, apiKey), usage: translateUsage(payload.usage) } };
}

const defaultTransport: ProviderTransport = async ({ url, headers, body, signal }) => {
  let response: Response;
  try { response = await fetch(url, { method: "POST", headers, body, signal }); } catch { throw new ProviderFailure("network_error"); }
  if (response.status < 200 || response.status > 299) { await response.body?.cancel().catch(() => {}); return { status: response.status, body: null }; }
  if (!response.body || typeof response.body.getReader !== "function") throw new ProviderFailure("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { received += value.byteLength; if (received > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); throw new ProviderFailure("response_too_large"); } chunks.push(decoder.decode(value, { stream: true })); }
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  chunks.push(decoder.decode());
  return { status: response.status, body: chunks.join("") };
};
async function requestWithTimeout(input: Omit<ProviderTransportRequest, "method" | "signal"> & { transport: ProviderTransport; timeoutMs: number }): Promise<ProviderTransportResponse> {
  const controller = new AbortController();
  let rejectTimeout: () => void = () => {};
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = () => { controller.abort(); reject(new Error("timeout")); }; });
  const timer = setTimeout(rejectTimeout, input.timeoutMs);
  try { return await Promise.race([input.transport({ url: input.url, method: "POST", headers: input.headers, body: input.body, signal: controller.signal }), timeout]); }
  catch (error) {
    if (controller.signal.aborted || error instanceof Error && error.message === "timeout") throw new ProviderFailure("timeout");
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure("network_error");
  } finally { clearTimeout(timer); }
}

export function createOpenAICompatibleProvider({ baseUrl, model, apiKeyEnv, env = process.env, transport = defaultTransport, timeoutMs = DEFAULT_TIMEOUT_MS }: OpenAICompatibleProviderOptions = {}): OpenAICompatibleProvider {
  const endpoint = normalizeEndpoint(baseUrl);
  const configuredModel = normalizeConfiguredModel(model);
  const apiKey = validateApiKeyEnv(apiKeyEnv, env);
  const configuredTimeout = validateTimeout(timeoutMs);
  if (typeof transport !== "function") throw new ProviderFailure("invalid_response");
  return {
    async complete(request: NormalizedProviderRequest): Promise<NormalizedProviderResponse> {
      const body = JSON.stringify({ model: configuredModel, messages: translateMessages(request), tools: translateTools(request.tools) });
      const responseValue: unknown = await requestWithTimeout({ transport, url: endpoint, headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body, timeoutMs: configuredTimeout });
      if (!isPlainObject(responseValue) || typeof responseValue.status !== "number" || !Number.isInteger(responseValue.status)) throw new ProviderFailure("invalid_response");
      if (responseValue.status < 200 || responseValue.status > 299) throw new ProviderFailure(outcomeFromStatus(responseValue.status), { httpStatus: responseValue.status });
      if (typeof responseValue.body !== "string") throw new ProviderFailure("invalid_response");
      if (utf8ByteLength(responseValue.body) > MAX_BODY_BYTES) throw new ProviderFailure("response_too_large");
      let payload: unknown;
      try { payload = JSON.parse(responseValue.body); } catch { throw new ProviderFailure("invalid_json"); }
      const candidate = translateResponse(payload, configuredModel, apiKey);
      return { ...candidate, providerCall: validateProviderCall(candidate.providerCall) };
    },
  };
}
