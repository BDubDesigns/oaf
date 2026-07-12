// First real provider adapter for the OAF-owned agent loop (issue #47).
//
// This deliberately implements only OpenAI-compatible Chat Completions with
// function tools. Configuration is explicit, credentials stay in the supplied
// environment, and the adapter exposes the existing complete(request) seam.

import {
  MAX_MODEL_IDENTIFIER_LENGTH,
  normalizeProviderIdentifier,
  ProviderFailure,
  validateProviderCall,
} from "./provider.mjs";
import { PUBLIC_TOOL_ERRORS } from "./tool-errors.mjs";

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

// Successful provider response bodies are bounded so a misbehaving endpoint
// cannot exhaust memory. The default transport enforces this while streaming.
export const MAX_BODY_BYTES = 1_048_576;

// UTF-8 byte length, used for body and model-id limits (string.length
// measures UTF-16 code units and would under-count multibyte input).
function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

const SUPPORTED_FINISH_REASONS = new Set(["stop", "tool_calls"]);

function outcomeFromStatus(status) {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "http_error";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OpenAI-compatible provider requires a non-empty ${label}.`);
  }
  return value;
}

function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function normalizeEndpoint(baseUrl) {
  requireNonEmptyString(baseUrl, "base URL");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("OpenAI-compatible provider base URL must be an absolute HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("OpenAI-compatible provider base URL must use HTTP or HTTPS.");
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    throw new Error("OpenAI-compatible provider permits plain HTTP only for loopback development addresses.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("OpenAI-compatible provider base URL must not include credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("OpenAI-compatible provider base URL must not include a query string or fragment.");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const normalized = `${parsed.protocol}//${parsed.host}${path}`;
  return normalized.endsWith(CHAT_COMPLETIONS_PATH)
    ? normalized
    : `${normalized}${CHAT_COMPLETIONS_PATH}`;
}

function validateTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`OpenAI-compatible provider timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}

function validateApiKeyEnv(apiKeyEnv, env) {
  requireNonEmptyString(apiKeyEnv, "API-key environment-variable name");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
    throw new Error("OpenAI-compatible provider API-key environment-variable name is invalid.");
  }
  const apiKey = env?.[apiKeyEnv];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error(`OpenAI-compatible provider requires a non-empty value in environment variable ${apiKeyEnv}.`);
  }
  return apiKey;
}

function translateToolCall(call) {
  if (!isPlainObject(call) || typeof call.id !== "string" || call.id.length === 0 ||
      typeof call.name !== "string" || call.name.length === 0 || !isPlainObject(call.args)) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received malformed prior assistant tool calls." });
  }
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  };
}

function translateMessages(request) {
  if (!isPlainObject(request) || typeof request.system !== "string" || !Array.isArray(request.messages)) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received an invalid OAF request." });
  }
  const messages = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (!isPlainObject(message)) {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received an invalid OAF message." });
    }
    if (message.role === "user") {
      if (typeof message.content !== "string") {
        throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received an invalid OAF user message." });
      }
      messages.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content !== null && message.content !== undefined && typeof message.content !== "string") {
        throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received an invalid OAF assistant message." });
      }
      const translated = { role: "assistant", content: message.content ?? null };
      if (message.toolCalls !== undefined) {
        if (!Array.isArray(message.toolCalls)) {
          throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received invalid prior assistant tool calls." });
        }
        translated.tool_calls = message.toolCalls.map(translateToolCall);
      }
      messages.push(translated);
      continue;
    }
    if (message.role === "tool") {
      if (!Array.isArray(message.toolResults)) {
        throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received invalid OAF tool results." });
      }
      for (const result of message.toolResults) {
        if (!isPlainObject(result) || typeof result.toolCallId !== "string" || result.toolCallId.length === 0) {
          throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received invalid OAF tool results." });
        }
        const code = Object.hasOwn(PUBLIC_TOOL_ERRORS, result.errorCode) ? result.errorCode : "TOOL_EXECUTION_FAILED";
        const content = Object.hasOwn(result, "error")
          ? JSON.stringify({ code, error: PUBLIC_TOOL_ERRORS[code] })
          : JSON.stringify(Object.hasOwn(result, "result") ? result.result : null);
        messages.push({ role: "tool", tool_call_id: result.toolCallId, content });
      }
      continue;
    }
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received an unsupported OAF message role." });
  }
  return messages;
}

function translateTools(tools) {
  if (!Array.isArray(tools)) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received invalid OAF tools." });
  }
  return tools.map((tool) => {
    if (!isPlainObject(tool) || typeof tool.name !== "string" || tool.name.length === 0 ||
        typeof tool.description !== "string" || !isPlainObject(tool.argsSchema)) {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider received an invalid OAF tool definition." });
    }
    return {
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.argsSchema },
    };
  });
}

function translateUsage(usage) {
  const value = (field) => Number.isInteger(usage?.[field]) && usage[field] >= 0 ? usage[field] : null;
  return {
    inputTokens: value("prompt_tokens"),
    outputTokens: value("completion_tokens"),
    totalTokens: value("total_tokens"),
  };
}

function sanitizeReportedModel(payload, apiKey) {
  if (typeof payload?.model !== "string") return null;
  const trimmed = payload.model.trim();
  if (apiKey && trimmed.includes(apiKey)) return null;
  return normalizeProviderIdentifier(trimmed, MAX_MODEL_IDENTIFIER_LENGTH);
}

function normalizeConfiguredModel(model) {
  const normalized = normalizeProviderIdentifier(model, MAX_MODEL_IDENTIFIER_LENGTH);
  if (normalized === null) {
    throw new Error("OpenAI-compatible provider requires a valid model ID.");
  }
  return normalized;
}

function translateToolCalls(message) {
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has malformed tool calls." });
  }
  const seenIds = new Set();
  return (message.tool_calls ?? []).map((call) => {
    if (!isPlainObject(call) || call.type !== "function" || !isPlainObject(call.function) ||
        typeof call.id !== "string" || call.id.trim().length === 0 ||
        typeof call.function.name !== "string" || call.function.name.trim().length === 0 ||
        typeof call.function.arguments !== "string") {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has a malformed function tool call." });
    }
    if (seenIds.has(call.id)) {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response contains duplicate tool-call IDs." });
    }
    seenIds.add(call.id);
    let args;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has invalid function arguments JSON." });
    }
    if (!isPlainObject(args)) {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response function arguments must be a plain object." });
    }
    return { id: call.id, name: call.function.name, args };
  });
}

// Strict, bounded termination handling. The loop treats any adapter response
// with no tool calls as terminal, so the adapter must refuse to claim success
// for incomplete, filtered, refused, or inconsistent responses.
function validateCompletion(message, toolCalls, finishReason) {
  if (typeof message.refusal === "string" && message.refusal.trim().length > 0) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response contained a model refusal." });
  }
  if (finishReason === "length") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response ended due to maximum length." });
  }
  if (finishReason === "content_filter") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response was blocked by a content filter." });
  }
  if (typeof finishReason !== "string") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has an unsupported or missing finish_reason." });
  }
  if (!SUPPORTED_FINISH_REASONS.has(finishReason)) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has an unsupported or missing finish_reason." });
  }
  if (finishReason === "tool_calls") {
    if (toolCalls.length === 0) {
      throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has finish_reason 'tool_calls' but no tool calls." });
    }
    return;
  }
  // finish_reason === "stop" is the only other supported terminal reason.
  if (toolCalls.length > 0) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has inconsistent finish_reason (stop with tool calls)." });
  }
  if (typeof message.content !== "string" || message.content.trim().length === 0) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has no terminal content." });
  }
}

function translateResponse(payload, configuredModel, apiKey) {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has no choices." });
  }
  const choice = payload.choices[0];
  const message = isPlainObject(choice) ? choice.message : null;
  if (!isPlainObject(message) || message.role !== "assistant") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has a malformed assistant message." });
  }
  if (message.content !== null && typeof message.content !== "string") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider response has invalid assistant content." });
  }

  const toolCalls = translateToolCalls(message);
  validateCompletion(message, toolCalls, choice.finish_reason);

  return {
    content: message.content,
    toolCalls,
    providerCall: {
      provider: "openai-compatible",
      requestedModel: configuredModel,
      reportedModel: sanitizeReportedModel(payload, apiKey),
      usage: translateUsage(payload.usage),
    },
  };
}

// Default transport uses built-in fetch. Non-2xx responses are not read, and
// successful bodies are decoded in bounded chunks so an oversized response is
// aborted mid-stream rather than buffered whole. Genuine network errors become
// a single bounded message; domain errors are marked and preserved.
async function defaultTransport({ url, headers, body, signal }) {
  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body, signal });
  } catch {
    throw new ProviderFailure("network_error", { message: "OpenAI-compatible provider request failed." });
  }
  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel?.().catch(() => {});
    return { status: response.status, body: null };
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider returned an invalid transport response." });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new ProviderFailure("response_too_large", { message: "OpenAI-compatible provider response exceeded the maximum allowed size." });
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  chunks.push(decoder.decode());
  return { status: response.status, body: chunks.join("") };
}

async function requestWithTimeout({ transport, url, headers, body, timeoutMs }) {
  const controller = new AbortController();
  let rejectTimeout;
  const timeout = new Promise((_, reject) => {
    rejectTimeout = () => {
      controller.abort();
      reject(new Error("timeout"));
    };
  });
  const timer = setTimeout(rejectTimeout, timeoutMs);
  try {
    return await Promise.race([
      transport({ url, method: "POST", headers, body, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (controller.signal.aborted || error instanceof Error && error.message === "timeout") {
      throw new ProviderFailure("timeout", { message: "OpenAI-compatible provider request timed out." });
    }
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure("network_error", { message: "OpenAI-compatible provider request failed." });
  } finally {
    clearTimeout(timer);
  }
}

// Return one narrow OpenAI-compatible Chat Completions provider. `transport` is
// injectable for deterministic tests; it receives only the explicit POST request
// fields and must return { status, body }. The default uses built-in fetch.
export function createOpenAICompatibleProvider({
  baseUrl,
  model,
  apiKeyEnv,
  env = process.env,
  transport = defaultTransport,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const endpoint = normalizeEndpoint(baseUrl);
  const configuredModel = normalizeConfiguredModel(model);
  const apiKey = validateApiKeyEnv(apiKeyEnv, env);
  const configuredTimeout = validateTimeout(timeoutMs);
  if (typeof transport !== "function") {
    throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider transport must be a function." });
  }

  return {
    async complete(request) {
      const body = JSON.stringify({
        model: configuredModel,
        messages: translateMessages(request),
        tools: translateTools(request.tools),
      });
      const response = await requestWithTimeout({
        transport,
        url: endpoint,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body,
        timeoutMs: configuredTimeout,
      });
      if (!isPlainObject(response) || !Number.isInteger(response.status)) {
        throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider returned an invalid transport response." });
      }
      if (response.status < 200 || response.status > 299) {
        throw new ProviderFailure(outcomeFromStatus(response.status), { httpStatus: response.status, message: `OpenAI-compatible provider request failed with HTTP status ${response.status}.` });
      }
      if (typeof response.body !== "string") {
        throw new ProviderFailure("invalid_response", { message: "OpenAI-compatible provider returned an invalid transport response." });
      }
      if (utf8ByteLength(response.body) > MAX_BODY_BYTES) {
        throw new ProviderFailure("response_too_large", { message: "OpenAI-compatible provider response exceeded the maximum allowed size." });
      }
      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        throw new ProviderFailure("invalid_json", { message: "OpenAI-compatible provider returned invalid JSON." });
      }
      const candidate = translateResponse(payload, configuredModel, apiKey);
      return {
        ...candidate,
        providerCall: validateProviderCall(candidate.providerCall),
      };
    },
  };
}
