// First real provider adapter for the OAF-owned agent loop (issue #47).
//
// This deliberately implements only OpenAI-compatible Chat Completions with
// function tools. Configuration is explicit, credentials stay in the supplied
// environment, and the adapter exposes the existing complete(request) seam.

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

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
    throw new Error("OpenAI-compatible provider received malformed prior assistant tool calls.");
  }
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  };
}

function translateMessages(request) {
  if (!isPlainObject(request) || typeof request.system !== "string" || !Array.isArray(request.messages)) {
    throw new Error("OpenAI-compatible provider received an invalid OAF request.");
  }
  const messages = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (!isPlainObject(message)) {
      throw new Error("OpenAI-compatible provider received an invalid OAF message.");
    }
    if (message.role === "user") {
      if (typeof message.content !== "string") {
        throw new Error("OpenAI-compatible provider received an invalid OAF user message.");
      }
      messages.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content !== null && message.content !== undefined && typeof message.content !== "string") {
        throw new Error("OpenAI-compatible provider received an invalid OAF assistant message.");
      }
      const translated = { role: "assistant", content: message.content ?? null };
      if (message.toolCalls !== undefined) {
        if (!Array.isArray(message.toolCalls)) {
          throw new Error("OpenAI-compatible provider received invalid prior assistant tool calls.");
        }
        translated.tool_calls = message.toolCalls.map(translateToolCall);
      }
      messages.push(translated);
      continue;
    }
    if (message.role === "tool") {
      if (!Array.isArray(message.toolResults)) {
        throw new Error("OpenAI-compatible provider received invalid OAF tool results.");
      }
      for (const result of message.toolResults) {
        if (!isPlainObject(result) || typeof result.toolCallId !== "string" || result.toolCallId.length === 0) {
          throw new Error("OpenAI-compatible provider received invalid OAF tool results.");
        }
        const content = Object.hasOwn(result, "error")
          ? JSON.stringify({ error: String(result.error) })
          : JSON.stringify(Object.hasOwn(result, "result") ? result.result : null);
        messages.push({ role: "tool", tool_call_id: result.toolCallId, content });
      }
      continue;
    }
    throw new Error("OpenAI-compatible provider received an unsupported OAF message role.");
  }
  return messages;
}

function translateTools(tools) {
  if (!Array.isArray(tools)) {
    throw new Error("OpenAI-compatible provider received invalid OAF tools.");
  }
  return tools.map((tool) => {
    if (!isPlainObject(tool) || typeof tool.name !== "string" || tool.name.length === 0 ||
        typeof tool.description !== "string" || !isPlainObject(tool.argsSchema)) {
      throw new Error("OpenAI-compatible provider received an invalid OAF tool definition.");
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

function translateResponse(payload, configuredModel) {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("OpenAI-compatible provider response has no choices.");
  }
  const choice = payload.choices[0];
  const message = isPlainObject(choice) ? choice.message : null;
  if (!isPlainObject(message) || message.role !== "assistant") {
    throw new Error("OpenAI-compatible provider response has a malformed assistant message.");
  }
  if (message.content !== null && typeof message.content !== "string") {
    throw new Error("OpenAI-compatible provider response has invalid assistant content.");
  }
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
    throw new Error("OpenAI-compatible provider response has malformed tool calls.");
  }

  const seenIds = new Set();
  const toolCalls = (message.tool_calls ?? []).map((call) => {
    if (!isPlainObject(call) || call.type !== "function" || !isPlainObject(call.function) ||
        typeof call.id !== "string" || call.id.trim().length === 0 ||
        typeof call.function.name !== "string" || call.function.name.trim().length === 0 ||
        typeof call.function.arguments !== "string") {
      throw new Error("OpenAI-compatible provider response has a malformed function tool call.");
    }
    if (seenIds.has(call.id)) {
      throw new Error("OpenAI-compatible provider response contains duplicate tool-call IDs.");
    }
    seenIds.add(call.id);
    let args;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new Error("OpenAI-compatible provider response has invalid function arguments JSON.");
    }
    if (!isPlainObject(args)) {
      throw new Error("OpenAI-compatible provider response function arguments must be a plain object.");
    }
    return { id: call.id, name: call.function.name, args };
  });

  return {
    content: message.content,
    toolCalls,
    usage: translateUsage(payload.usage),
    model: configuredModel,
    provider: "openai-compatible",
  };
}

async function defaultTransport({ url, headers, body, signal }) {
  const response = await fetch(url, { method: "POST", headers, body, signal });
  return { status: response.status, body: await response.text() };
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
      throw new Error("OpenAI-compatible provider request timed out.");
    }
    throw new Error("OpenAI-compatible provider request failed.");
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
  const configuredModel = requireNonEmptyString(model, "model ID");
  const apiKey = validateApiKeyEnv(apiKeyEnv, env);
  const configuredTimeout = validateTimeout(timeoutMs);
  if (typeof transport !== "function") {
    throw new Error("OpenAI-compatible provider transport must be a function.");
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
        throw new Error("OpenAI-compatible provider returned an invalid transport response.");
      }
      if (response.status < 200 || response.status > 299) {
        throw new Error(`OpenAI-compatible provider request failed with HTTP status ${response.status}.`);
      }
      if (typeof response.body !== "string") {
        throw new Error("OpenAI-compatible provider returned an invalid transport response.");
      }
      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        throw new Error("OpenAI-compatible provider returned invalid JSON.");
      }
      return translateResponse(payload, configuredModel);
    },
  };
}
