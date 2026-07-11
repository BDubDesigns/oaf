// Focused coverage for the first real OpenAI-compatible provider adapter.
// Every transport here is injected: no network and no real credential are used.
import { deepEqual } from "node:assert";
import { createOpenAICompatibleProvider } from "../lib/agent/openai-compatible-provider.mjs";
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

function response(message, usage) {
  return JSON.stringify({ choices: [{ message }], ...(usage === undefined ? {} : { usage }) });
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
    deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, "provider usage maps when present");
    assert(result.model === "test-model" && result.provider === "openai-compatible", "safe provider metadata is returned");
    assert(JSON.stringify(oafRequest) === before, "request and message history are not mutated during translation");
  }

  // 2. One, multiple, and text-plus-tool calls all preserve protocol fields.
  {
    const one = await providerWith(response({ role: "assistant", content: null, tool_calls: [
      { id: "call-one", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
    ] })).complete(request());
    deepEqual(one.toolCalls, [{ id: "call-one", name: "read", args: { path: "README.md" } }], "one valid tool call translates");

    const many = await providerWith(response({ role: "assistant", content: "I will inspect both.", tool_calls: [
      { id: "call-a", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
      { id: "call-b", type: "function", function: { name: "list", arguments: '{"path":"."}' } },
    ] })).complete(request());
    assert(many.content === "I will inspect both." && many.toolCalls.length === 2 && many.toolCalls[1].id === "call-b",
      "multiple calls and assistant text translate together");
    deepEqual(many.usage, { inputTokens: null, outputTokens: null, totalTokens: null }, "missing usage remains unavailable, never zero");
  }

  // 3. Full OAF history remains present, including assistant calls and each result.
  {
    const captured = [];
    const provider = providerWith(response({ role: "assistant", content: "next" }), captured);
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
      [JSON.stringify({ choices: [] }), /no choices/, "empty choices"],
      [response({ role: "user", content: "wrong role" }), /malformed assistant message/, "malformed assistant message"],
      [response({ role: "assistant", content: 3 }), /invalid assistant content/, "non-string assistant content"],
      [response({ role: "assistant", content: null, tool_calls: [{}] }), /malformed function tool call/, "malformed tool-call shape"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "custom", function: { name: "read", arguments: "{}" } }] }), /malformed function tool call/, "non-function tool-call type"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "", type: "function", function: { name: "read", arguments: "{}" } }] }), /malformed function tool call/, "empty tool-call ID"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "", arguments: "{}" } }] }), /malformed function tool call/, "empty function name"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: 3 } }] }), /malformed function tool call/, "non-string function arguments"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "{" } }] }), /invalid function arguments JSON/, "malformed tool argument JSON"],
      [response({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "[]" } }] }), /plain object/, "non-object parsed tool arguments"],
      [response({ role: "assistant", content: null, tool_calls: [
        { id: "same", type: "function", function: { name: "read", arguments: "{}" } },
        { id: "same", type: "function", function: { name: "list", arguments: "{}" } },
      ] }), /duplicate tool-call IDs/, "duplicate IDs in one provider response"],
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

  // 8. Integration: adapter -> existing loop -> real registered read -> adapter -> terminal.
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
        ] }, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }) };
        return { status: 200, body: response({ role: "assistant", content: "completed" }, { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 }) };
      },
    });
    const result = await runAgentLoop({ task: "read the readme", workspaceRoot: withFixture(), provider, maxTurns: 3 });
    const toolMessage = requests[1].messages.find((message) => message.role === "tool" && message.tool_call_id === "real-read");
    assert(result.status === "success" && result.terminalReason === "assistant_terminal" && result.turns === 2,
      "adapter integration ends through the existing loop terminal path");
    assert(result.events.some((event) => event.type === "tool_result" && event.toolCallId === "real-read" && event.result?.content.includes("Opinionated App Factory")),
      "existing registry validates and executes the real workspace read tool");
    assert(typeof toolMessage?.content === "string" && toolMessage.content.includes("Opinionated App Factory"),
      "second provider request contains the matching tool result");
    deepEqual(result.usage, { inputTokens: 9, outputTokens: 1, totalTokens: 10 }, "loop preserves additive provider usage metadata");
  }

  // 9. Run-scoped duplicate protection rejects an ID reused on a later turn before dispatch.
  {
    let calls = 0;
    const provider = createOpenAICompatibleProvider({
      ...config,
      transport: async () => {
        calls++;
        return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
          { id: "reused", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
        ] }) };
      },
    });
    const result = await runAgentLoop({ task: "read twice", workspaceRoot: withFixture(), provider, maxTurns: 3 });
    assert(calls === 2 && result.status === "failed" && result.terminalReason === "provider_error",
      "reused ID across turns takes the existing provider-error path");
    assert(result.events.filter((event) => event.type === "tool_call" && event.toolCallId === "reused").length === 1,
      "reused ID is rejected before a second ambiguous tool dispatch");
    assert(result.events.some((event) => event.type === "message_end" && /reuses a tool-call ID/.test(event.error)),
      "duplicate-ID failure is recorded as a bounded provider error");
  }

  // 10. Distinct IDs on separate provider turns remain valid within one run.
  {
    let turn = 0;
    const provider = createOpenAICompatibleProvider({
      ...config,
      transport: async () => {
        turn++;
        if (turn <= 2) {
          return { status: 200, body: response({ role: "assistant", content: null, tool_calls: [
            { id: `unique-${turn}`, type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } },
          ] }) };
        }
        return { status: 200, body: response({ role: "assistant", content: "done" }) };
      },
    });
    const result = await runAgentLoop({ task: "read twice", workspaceRoot: withFixture(), provider, maxTurns: 4 });
    assert(result.status === "success" && result.turns === 3 &&
      result.events.filter((event) => event.type === "tool_call").map((event) => event.toolCallId).join(",") === "unique-1,unique-2",
    "unique IDs across multiple turns dispatch and complete normally");
  }
} finally {
  for (const fixture of fixtures) fixture.cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} OpenAI-compatible provider check(s) failed.`);
  process.exit(1);
}
console.log("\nAll OpenAI-compatible provider checks passed.");
