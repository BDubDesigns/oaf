// Focused coverage for the first real OpenAI-compatible provider adapter.
// Every transport here is injected unless a test explicitly exercises the
// built-in fetch transport with an overridden global fetch (no real network).
import { deepEqual } from "node:assert";
import {
  createOpenAICompatibleProvider,
  MAX_BODY_BYTES,
} from "../lib/agent/openai-compatible-provider.mjs";
import { runAgentLoop } from "../lib/agent/loop.mjs";
import { buildToolProtocol } from "../lib/agent/provider.mjs";
import { copyGeneratedAppFixture } from "./generated-app-fixture-helper.mjs";

let failures = 0;
function assert(condition, message) {
  if (condition) console.log(`PASS  ${message}`);
  else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

async function rejects(action, pattern, message) {
  try {
    await action();
    assert(false, message);
  } catch (error) {
    assert(pattern.test(error.message), message);
  }
}

const API_KEY = "OPENAI_PROVIDER_SECRET_SENTINEL";
const config = {
  baseUrl: "https://models.example.test/v1/",
  model: "test-model",
  apiKeyEnv: "OAF_TEST_OPENAI_KEY",
  env: { OAF_TEST_OPENAI_KEY: API_KEY },
};

function request({ messages = [{ role: "user", content: "hello" }], tools = buildToolProtocol() } = {}) {
  return { system: "OAF system context", messages, tools };
}

function response(message, usage, finishReason = "stop") {
  const choice = { message };
  if (finishReason !== null) choice.finish_reason = finishReason;
  return JSON.stringify({ choices: [choice], ...(usage === undefined ? {} : { usage }) });
}

function providerWith(body, captured = []) {
  return createOpenAICompatibleProvider({
    ...config,
    transport: async (input) => {
      captured.push(input);
      return { status: 200, body: typeof body === "function" ? body(input) : body };
    },
  });
}

const fixtures = [];
function withFixture() {
  const fixture = copyGeneratedAppFixture();
  fixtures.push(fixture);
  return fixture.workspace;
}

try {
  // 1. Terminal text, endpoint/model, system context, fixed tools, and usage.
  {
    const captured = [];
    const provider = providerWith(response({ role: "assistant", content: "finished" }, {
      prompt_tokens: 11, completion_tokens: 7, total_tokens: 18,
    }), captured);
    const oafRequest = request();
    const before = JSON.stringify(oafRequest);
    const result = await provider.complete(oafRequest);
    const sent = JSON.parse(captured[0].body);
    assert(result.content === "finished" && result.toolCalls.length === 0, "terminal assistant text translates through complete()");
    assert(captured[0].url === "https://models.example.test/v1/chat/completions" && captured[0].method === "POST",
      "configured base URL is normalized and Chat Completions is appended once");
    assert(sent.model === "test-model" && sent.messages[0].role === "system" && sent.messages[0].content === "OAF system context",
      "configured model and system message are sent explicitly");
    assert(sent.tools.length === 5 && sent.tools.every((tool) => tool.type === "function" && tool.function.parameters),
      "fixed registry schemas translate to function tools without duplication");
    deepEqual(result.providerCall.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, "provider usage maps when present");
    assert(result.providerCall.requestedModel === "test-model" && result.providerCall.provider === "openai-compatible",
      "safe provider metadata is returned");
    assert(JSON.stringify(oafRequest) === before, "request and message history are not mutated during translation");
  }

  // 1b. Requested models are trusted explicit configuration, normalized once.
  {
    const captured = [];
    const provider = createOpenAICompatibleProvider({
      ...config,
      model: " vendor/model-name ",
      transport: async (input) => {
        captured.push(input);
        return { status: 200, body: response({ role: "assistant", content: "ok" }, undefined, "stop") };
      },
    });
    const result = await provider.complete(request());
    const sent = JSON.parse(captured[0].body);
    assert(sent.model === "vendor/model-name", "configured vendor/model-name is normalized before sending");
    assert(result.providerCall.requestedModel === "vendor/model-name", "normalized configured model is retained as requestedModel");

    let transportCalls = 0;
    const neverTransport = async () => { transportCalls++; throw new Error("must not run"); };
    await rejects(
      () => createOpenAICompatibleProvider({ ...config, model: "   ", transport: neverTransport }).complete(request()),
      /model ID/,
      "empty configured model fails before transport",
    );
    await rejects(
      () => createOpenAICompatibleProvider({ ...config, model: "x".repeat(129), transport: neverTransport }).complete(request()),
      /model ID/,
      "oversized configured model fails before transport",
    );
    assert(transportCalls === 0, "invalid configured models never reach transport");
  }

  // 2. One, multiple, and text-plus-tool calls all preserve protocol fields.
  {
    const one = await providerWith(response({ role: "assistant", content: null, tool_calls: [
      { id: "call-one", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
    ] }, undefined, "tool_calls")).complete(request());
    deepEqual(one.toolCalls, [{ id: "call-one", name: "read", args: { path: "README.md" } }], "one valid tool call translates");

    const many = await providerWith(response({ role: "assistant", content: "I will inspect both.", tool_calls: [
      { id: "call-a", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
      { id: "call-b", type: "function", function: { name: "list", arguments: '{"path":"."}' } },
    ] }, undefined, "tool_calls")).complete(request());
    assert(many.content === "I will inspect both." && many.toolCalls.length === 2 && many.toolCalls[1].id === "call-b",
      "multiple calls and assistant text translate together");
    deepEqual(many.providerCall.usage, { inputTokens: null, outputTokens: null, totalTokens: null }, "missing usage remains unavailable, never zero");
  }

  // 3. Full OAF history remains present, including assistant calls and each result.
  {
    const captured = [];
    const provider = providerWith(response({ role: "assistant", content: "next" }, undefined, "stop"), captured);
    await provider.complete(request({ messages: [
      { role: "user", content: "read both files" },
      { role: "assistant", content: null, toolCalls: [
        { id: "history-a", name: "read", args: { path: "README.md" } },
        { id: "history-b", name: "list", args: { path: "." } },
      ] },
      { role: "tool", toolResults: [
        { toolCallId: "history-a", toolName: "read", result: { path: "README.md", content: "x" } },
        { toolCallId: "history-b", toolName: "list", error: "blocked" },
      ] },
    ] }));
    const messages = JSON.parse(captured[0].body).messages;
    assert(messages.length === 5 && messages[1].content === "read both files", "user history is not silently dropped");
    assert(messages[2].tool_calls.length === 2 && messages[2].tool_calls[0].function.arguments === '{"path":"README.md"}',
      "prior assistant tool calls use OpenAI-compatible function shape");
    assert(messages[3].role === "tool" && messages[3].tool_call_id === "history-a" &&
      messages[4].role === "tool" && messages[4].tool_call_id === "history-b",
    "each prior OAF tool result becomes its own associated tool message");
  }

  // 4. Configuration fails closed before any transport call, without key values.
  {
    const noTransport = () => { throw new Error("transport must not run"); };
    await rejects(() => createOpenAICompatibleProvider({ ...config, baseUrl: undefined, transport: noTransport }).complete(request()), /base URL/, "missing base URL is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, baseUrl: "not-a-url", transport: noTransport }).complete(request()), /absolute HTTP or HTTPS/, "invalid URL is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, baseUrl: "https://user:pass@models.example.test", transport: noTransport }).complete(request()), /must not include credentials/, "credential-bearing URL is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, baseUrl: "https://models.example.test/v1?key=x", transport: noTransport }).complete(request()), /query string or fragment/, "URL query string is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, baseUrl: "https://models.example.test/v1#fragment", transport: noTransport }).complete(request()), /query string or fragment/, "URL fragment is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, baseUrl: "http://models.example.test", transport: noTransport }).complete(request()), /loopback/, "public plain HTTP is rejected");
    let loopbackPermitted = true;
    try {
      createOpenAICompatibleProvider({ ...config, baseUrl: "http://127.0.0.1:8080/v1", transport: noTransport });
    } catch {
      loopbackPermitted = false;
    }
    assert(loopbackPermitted, "loopback plain HTTP is permitted");
    await rejects(() => createOpenAICompatibleProvider({ ...config, model: "", transport: noTransport }).complete(request()), /model ID/, "missing model is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, apiKeyEnv: "BAD-NAME", transport: noTransport }).complete(request()), /environment-variable name is invalid/, "invalid credential variable name is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, env: {}, transport: noTransport }).complete(request()), /OAF_TEST_OPENAI_KEY/, "missing credential value is rejected");
    await rejects(() => createOpenAICompatibleProvider({ ...config, timeoutMs: 0, transport: noTransport }).complete(request()), /timeoutMs/, "invalid timeout is rejected");
  }

  // 5. Transport and remote failures stay bounded and never echo secrets/body.
  {
    const errors = [];
    const non2xx = createOpenAICompatibleProvider({ ...config, transport: async () => ({ status: 401, body: `remote ${API_KEY} Authorization: Bearer ${API_KEY}` }) });
    try { await non2xx.complete(request({ messages: [{ role: "user", content: "PROMPT_SENTINEL" }] })); } catch (error) { errors.push(error.message); }
    const badJson = createOpenAICompatibleProvider({ ...config, transport: async () => ({ status: 200, body: `{${API_KEY}` }) });
    try { await badJson.complete(request()); } catch (error) { errors.push(error.message); }
    const failedTransport = createOpenAICompatibleProvider({ ...config, transport: async () => { throw new Error(`remote error ${API_KEY}`); } });
    try { await failedTransport.complete(request()); } catch (error) { errors.push(error.message); }
    const serializedErrors = JSON.stringify(errors);
    assert(errors[0] === "OpenAI-compatible provider request failed with HTTP status 401.", "non-2xx response exposes only safe status facts");
    assert(errors[1] === "OpenAI-compatible provider returned invalid JSON.", "invalid JSON has a bounded generic error");
    assert(errors[2] === "OpenAI-compatible provider request failed.", "transport failure has a bounded generic error");
    assert(!serializedErrors.includes(API_KEY) && !serializedErrors.includes("PROMPT_SENTINEL") && !serializedErrors.includes("Authorization"),
      "provider errors and serialized test output omit API-key and authorization sentinels");
  }

  // 6. Strict response validation rejects malformed protocol data before dispatch.
  {
    const cases = [
      [response({ role: "user", content: "wrong role" }, undefined, "stop"), /malformed assistant message/, "malformed assistant message"],
      [response({ role: "assistant", content: 3 }, undefined, "stop"), /invalid assistant content/, "non-string assistant content"],
      [response({ role: "assistant", content: null, tool_calls: [{}] }, undefined, "tool_calls"), /malformed function tool call/, "malformed tool-call shape"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "custom", function: { name: "read", arguments: "{}" } }] }, undefined, "tool_calls"), /malformed function tool call/, "non-function tool-call type"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "", type: "function", function: { name: "read", arguments: "{}" } }] }, undefined, "tool_calls"), /malformed function tool call/, "empty tool-call ID"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "", arguments: "{}" } }] }, undefined, "tool_calls"), /malformed function tool call/, "empty function name"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: 3 } }] }, undefined, "tool_calls"), /malformed function tool call/, "non-string function arguments"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "{" } }] }, undefined, "tool_calls"), /invalid function arguments JSON/, "malformed tool argument JSON"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "[]" } }] }, undefined, "tool_calls"), /plain object/, "non-object parsed tool arguments"],
      [response({ role: "assistant", content: null, tool_calls: [
        { id: "same", type: "function", function: { name: "read", arguments: "{}" } },
        { id: "same", type: "function", function: { name: "list", arguments: "{}" } },
      ] }, undefined, "tool_calls"), /duplicate tool-call IDs/, "duplicate IDs in one provider response"],
    ];
    for (const [body, pattern, label] of cases) {
      await rejects(() => providerWith(body).complete(request()), pattern, `${label} is rejected`);
    }
  }

  // 7. Timeout aborts the injected request and returns through the safe provider error path.
  {
    let aborted = false;
    const timeoutProvider = createOpenAICompatibleProvider({
      ...config,
      timeoutMs: 10,
      transport: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(new Error(`aborted ${API_KEY}`)); }, { once: true });
      }),
    });
    await rejects(() => timeoutProvider.complete(request()), /request timed out/, "timeout produces a bounded error");
    assert(aborted, "timeout aborts the in-flight transport signal");
    let timeoutError = "";
    try { await timeoutProvider.complete(request()); } catch (error) { timeoutError = error.message; }
    assert(!timeoutError.includes(API_KEY) && !timeoutError.includes("Authorization"), "timeout error omits API-key and authorization values");

    let configurationError = "";
    try { createOpenAICompatibleProvider({ ...config, env: { OAF_TEST_OPENAI_KEY: "" } }); } catch (error) { configurationError = error.message; }
    assert(!configurationError.includes(API_KEY) && !configurationError.includes("Authorization"), "configuration error omits API-key and authorization values");
  }

  // 8. BLOCKER 1: finish_reason is required and parsed honestly.
  {
    const finish = (message, finishReason) => providerWith(response(message, undefined, finishReason)).complete(request());
    const ok = await finish({ role: "assistant", content: "done" }, "stop");
    assert(ok.content === "done" && ok.toolCalls.length === 0, "stop plus terminal text succeeds");

    const tools = await finish({ role: "assistant", content: null, tool_calls: [
      { id: "t1", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
    ] }, "tool_calls");
    assert(tools.toolCalls.length === 1, "tool_calls finish reason with valid calls continues");

    await rejects(() => finish({ role: "assistant", content: "partial" }, "length"), /maximum length/, "length does not succeed");
    await rejects(() => finish({ role: "assistant", content: "blocked" }, "content_filter"), /content filter/, "content_filter does not succeed");
    await rejects(() => finish({ role: "assistant", content: "I cannot help", refusal: "I cannot help with that" }, "stop"), /model refusal/, "refusal does not succeed");
    await rejects(() => finish({ role: "assistant", content: null }, "stop"), /no terminal content/, "null content with no tool calls does not succeed");
    await rejects(() => finish({ role: "assistant", content: "   " }, "stop"), /no terminal content/, "whitespace-only content with no tool calls does not succeed");
    await rejects(() => finish({ role: "assistant", content: null, tool_calls: [] }, "tool_calls"), /no tool calls/, "tool_calls finish reason with no calls fails");
    await rejects(() => finish({ role: "assistant", content: "hi", tool_calls: [
      { id: "t1", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
    ] }, "stop"), /inconsistent finish_reason/, "inconsistent stop-plus-tool-calls fails");
    await rejects(() => finish({ role: "assistant", content: "hi" }, null), /unsupported or missing finish_reason/, "missing finish reason fails closed");
    await rejects(() => finish({ role: "assistant", content: "hi" }, "weird_reason"), /unsupported or missing finish_reason/, "unknown finish reason fails closed");
  }

  // 9. BLOCKER 2: requested and reported model identity are preserved separately.
  {
    const reported = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: "actual-model-x",
    })).complete(request());
    assert(reported.providerCall.requestedModel === "test-model" && reported.providerCall.reportedModel === "actual-model-x",
      "requested and reported models can differ and both are preserved");

    const namespaced = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: "vendor/model-revision",
    })).complete(request());
    assert(namespaced.providerCall.reportedModel === "vendor/model-revision", "safe namespaced reported model is retained");

    const trimmed = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: "  actual-model-trim  ",
    })).complete(request());
    assert(trimmed.providerCall.reportedModel === "actual-model-trim", "reported model identifiers are trimmed");

    const absent = await providerWith(response({ role: "assistant", content: "hi" }, undefined, "stop")).complete(request());
    assert(absent.providerCall.reportedModel === null, "absent reported model remains null");

    const malformed = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: 123,
    })).complete(request());
    assert(malformed.providerCall.reportedModel === null, "non-string reported model becomes null per contract");

    // Reported model identifiers are bounded, trimmed, and constrained.
    const oversized = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: "x".repeat(200),
    })).complete(request());
    assert(oversized.providerCall.reportedModel === null, "oversized reported model becomes null");

    const whitespace = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: "   ",
    })).complete(request());
    assert(whitespace.providerCall.reportedModel === null, "whitespace-only reported model becomes null");

    const badCharset = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: "bad model/id!",
    })).complete(request());
    assert(badCharset.providerCall.reportedModel === null, "malformed-charset reported model becomes null");

    // A provider that echoes the API key in the model field must not retain it.
    const echoed = await providerWith(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] }, finish_reason: "stop" }],
      model: `real-${API_KEY}`,
    })).complete(request());
    assert(echoed.providerCall.reportedModel === null, "API-key echo in model field is dropped");
    assert(!JSON.stringify(echoed.providerCall).includes(API_KEY), "serialized provider metadata omits the API key");

    const missingUsage = await providerWith(response({ role: "assistant", content: "hi" }, undefined, "stop")).complete(request());
    deepEqual(missingUsage.providerCall.usage, { inputTokens: null, outputTokens: null, totalTokens: null },
      "one call with missing usage remains explicitly incomplete");

    // Two provider calls retain both calls' usage.
    const calls = [];
    const twoShot = createOpenAICompatibleProvider({
      ...config,
      transport: async () => {
        calls.push(true);
        if (calls.length === 1) {
          return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
            { id: "c1", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
          ] }, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, "tool_calls") };
        }
        return { status: 200, body: response({ role: "assistant", content: "done" }, { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 }, "stop") };
      },
    });
    const first = await twoShot.complete(request());
    assert(first.toolCalls.length === 1, "first provider call returns tool calls");
    const second = await twoShot.complete(request());
    assert(second.content === "done", "second provider call returns terminal text");
    deepEqual(first.providerCall.usage, { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, "first call usage is preserved");
    deepEqual(second.providerCall.usage, { inputTokens: 9, outputTokens: 1, totalTokens: 10 }, "second call usage is preserved");

    // Provider metadata never carries raw secrets, prompts, or headers.
    const metaJson = JSON.stringify(reported.providerCall);
    assert(!metaJson.includes(API_KEY) && !metaJson.includes("Authorization") && !metaJson.includes("PROMPT_SENTINEL"),
      "no raw key, authorization, or prompt enters provider metadata");
  }

  // 10. Integration: adapter -> existing loop -> real registered read -> adapter -> terminal.
  {
    const requests = [];
    let turn = 0;
    const provider = createOpenAICompatibleProvider({
      ...config,
      transport: async (input) => {
        requests.push(JSON.parse(input.body));
        turn++;
        if (turn === 1) return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
          { id: "real-read", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
        ] }, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, "tool_calls") };
        return { status: 200, body: response({ role: "assistant", content: "completed" }, { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 }, "stop") };
      },
    });
    const result = await runAgentLoop({ task: "read the readme", workspaceRoot: withFixture(), provider, maxTurns: 3 });
    const toolMessage = requests[1].messages.find((message) => message.role === "tool" && message.tool_call_id === "real-read");
    assert(result.status === "success" && result.terminalReason === "assistant_terminal" && result.turns === 2,
      "adapter integration ends through the existing loop terminal path");
    assert(result.events.some((event) => event.type === "tool_result" && event.toolCallId === "real-read" && event.summary.path === "README.md" && event.summary.bytes > 0),
      "existing registry validates and executes the real workspace read tool safely");
    assert(typeof toolMessage?.content === "string" && toolMessage.content.includes("Opinionated App Factory"),
      "second provider request contains the matching tool result");
    deepEqual(result.providerCalls, [
      { turn: 1, provider: "openai-compatible", requestedModel: "test-model", reportedModel: null, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      { turn: 2, provider: "openai-compatible", requestedModel: "test-model", reportedModel: null, usage: { inputTokens: 9, outputTokens: 1, totalTokens: 10 } },
    ], "loop preserves per-call provider usage metadata");
  }

  // 11. Run-scoped duplicate protection rejects an ID reused on a later turn before dispatch.
  {
    let calls = 0;
    const provider = createOpenAICompatibleProvider({
      ...config,
      transport: async () => {
        calls++;
        return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
          { id: "reused", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
        ] }, undefined, "tool_calls") };
      },
    });
    const result = await runAgentLoop({ task: "read twice", workspaceRoot: withFixture(), provider, maxTurns: 3 });
    assert(calls === 2 && result.status === "failed" && result.terminalReason === "provider_error",
      "reused ID across turns takes the existing provider-error path");
    assert(result.events.filter((event) => event.type === "tool_call" && event.toolCallId === "reused").length === 1,
      "reused ID is rejected before a second ambiguous tool dispatch");
    assert(result.events.some((event) => event.type === "message_end" && event.errorCode === "provider_error"),
      "duplicate-ID failure is recorded as a bounded provider error");
  }

  // 12. Distinct IDs on separate provider turns remain valid within one run.
  {
    let turn = 0;
    const provider = createOpenAICompatibleProvider({
      ...config,
      transport: async () => {
        turn++;
        if (turn <= 2) {
          return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
            { id: `unique-${turn}`, type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
          ] }, undefined, "tool_calls") };
        }
        return { status: 200, body: response({ role: "assistant", content: "done" }, undefined, "stop") };
      },
    });
    const result = await runAgentLoop({ task: "read twice", workspaceRoot: withFixture(), provider, maxTurns: 4 });
    assert(result.status === "success" && result.turns === 3 &&
      result.events.filter((event) => event.type === "tool_call").map((event) => event.toolCallId).join(",") === "unique-1,unique-2",
    "unique IDs across multiple turns dispatch and complete normally");
  }

  // 13. BLOCKER 2: a provider failure after one successful call keeps only prior completed-call metadata.
  {
    let turn = 0;
    const provider = createOpenAICompatibleProvider({
      ...config,
      transport: async () => {
        turn++;
        if (turn === 1) return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
          { id: "ok-1", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
        ] }, { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }, "tool_calls") };
        return { status: 500, body: `remote ${API_KEY}` };
      },
    });
    const result = await runAgentLoop({ task: "read then fail", workspaceRoot: withFixture(), provider, maxTurns: 3 });
    assert(result.status === "failed" && result.terminalReason === "provider_error", "second failed call ends the run as failed");
    assert(result.providerCalls.length === 1, "only the prior completed call metadata is preserved");
    deepEqual(result.providerCalls[0].usage, { inputTokens: 4, outputTokens: 1, totalTokens: 5 }, "preserved call keeps its usage");
  }

  // 14. BLOCKER 3: built-in fetch transport enforces bounded, non-consumed bodies.
  {
    const realFetch = globalThis.fetch;
    const makeStream = (chunks, onCancel) => new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
      cancel() { if (onCancel) onCancel(); },
    });
    try {
      // Normal bounded response still succeeds through the real default transport.
      const okPayload = JSON.stringify({ choices: [{ message: { role: "assistant", content: "bounded", tool_calls: [] }, finish_reason: "stop" }], model: "reported-y" });
      globalThis.fetch = async () => ({ status: 200, body: makeStream([okPayload]) });
      const okProvider = createOpenAICompatibleProvider({ ...config });
      const okResult = await okProvider.complete(request());
      assert(okResult.content === "bounded" && okResult.providerCall.reportedModel === "reported-y", "normal bounded response succeeds via default transport");

      // Non-2xx response body is never consumed.
      let bodyRead = false;
      let bodyCancelled = false;
      const fakeBody = {
        getReader() {
          bodyRead = true;
          return { read: async () => ({ done: true, value: undefined }), cancel: async () => {} };
        },
        async cancel() { bodyCancelled = true; },
      };
      globalThis.fetch = async () => ({ status: 401, body: fakeBody });
      let non2xxError = "";
      try { await okProvider.complete(request()); } catch (error) { non2xxError = error.message; }
      assert(non2xxError === "OpenAI-compatible provider request failed with HTTP status 401.", "non-2xx error is generic and status-only");
      assert(!bodyRead, "non-2xx response body is never read");
      assert(bodyCancelled, "non-2xx response body is cancelled without reading");

      // Oversized successful body is rejected and the stream is cancelled at the limit.
      let cancelled = false;
      const sentinel = "BODY_SENTINEL_XYZ";
      const big = `${sentinel}${"x".repeat(MAX_BODY_BYTES + 1000)}`;
      globalThis.fetch = async () => ({
        status: 200,
        body: new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(big)); },
          cancel() { cancelled = true; },
        }),
      });
      let oversizeError = "";
      try { await okProvider.complete(request()); } catch (error) { oversizeError = error.message; }
      assert(/exceeded the maximum allowed size/.test(oversizeError), "oversized successful body is rejected while reading");
      assert(cancelled, "response stream is cancelled/aborted at the limit");
      assert(!oversizeError.includes(sentinel), "oversize error omits remote body fragments");

      // Oversized injected-transport string is rejected before JSON parsing.
      let injectedError = "";
      try { await providerWith("x".repeat(MAX_BODY_BYTES + 1)).complete(request()); } catch (error) { injectedError = error.message; }
      assert(/exceeded the maximum allowed size/.test(injectedError), "oversized injected body is rejected before JSON parsing");

      // Multibyte UTF-8 body whose JS string length is within the limit but
      // whose byte length exceeds it is rejected before JSON parsing.
      let multibyteError = "";
      const emoji = "🖂".repeat(300_000); // length 600000 (<= limit), bytes 1200000 (> 1 MiB)
      try { await providerWith(emoji).complete(request()); } catch (error) { multibyteError = error.message; }
      assert(/exceeded the maximum allowed size/.test(multibyteError), "multibyte UTF-8 body exceeds the byte limit");
      assert(!multibyteError.includes("🖂"), "multibyte oversize error omits body fragments");
    // 15. BLOCKER 1: malformed providerCall metadata takes the provider-error path.
    {
      const badShape = {
        async complete() {
          return {
            content: "x",
            toolCalls: [],
            providerCall: { provider: 123, requestedModel: "m", reportedModel: "ok", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          };
        },
      };
      const shapeResult = await runAgentLoop({ task: "x", workspaceRoot: withFixture(), provider: badShape });
      assert(shapeResult.status === "failed" && shapeResult.terminalReason === "provider_error",
        "malformed providerCall shape takes the existing provider-error path");

      const extraField = {
        async complete() {
          return {
            content: "x",
            toolCalls: [],
            providerCall: { provider: "openai-compatible", requestedModel: "m", reportedModel: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, secret: "remote content" },
          };
        },
      };
      const extraResult = await runAgentLoop({ task: "x", workspaceRoot: withFixture(), provider: extraField });
      assert(extraResult.status === "failed" && extraResult.terminalReason === "provider_error",
        "extra arbitrary providerCall field is rejected");

      const badUsage = {
        async complete() {
          return {
            content: "x",
            toolCalls: [],
            providerCall: { provider: "openai-compatible", requestedModel: "m", reportedModel: null, usage: { inputTokens: "big", outputTokens: 1, totalTokens: 2 } },
          };
        },
      };
      const usageResult = await runAgentLoop({ task: "x", workspaceRoot: withFixture(), provider: badUsage });
      assert(usageResult.status === "failed" && usageResult.terminalReason === "provider_error",
        "non-integer usage field is rejected");
    }
    } finally {
      globalThis.fetch = realFetch;
    }
  }
} finally {
  for (const fixture of fixtures) fixture.cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} OpenAI-compatible provider check(s) failed.`);
  process.exit(1);
}
console.log("\nAll OpenAI-compatible provider checks passed.");
