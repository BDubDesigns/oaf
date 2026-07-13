import { createOpenAICompatibleProvider, type ProviderTransport } from "../../lib/agent/openai-compatible-provider.ts";
import { buildToolProtocol, createMockProvider } from "../../lib/agent/provider.ts";
import type { NormalizedProviderRequest, NormalizedProviderResponse, Provider, ProviderAttempt } from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type Assignable<From, To> = From extends To ? true : false;

type AdapterIsProvider = Assert<Assignable<ReturnType<typeof createOpenAICompatibleProvider>, Provider>>;
type AdapterResponseIsNormalized = Assert<Equal<Awaited<ReturnType<ReturnType<typeof createOpenAICompatibleProvider>["complete"]>>, NormalizedProviderResponse>>;
type HttpFailureRequiresStatus = Assert<Equal<Assignable<{ turn: number; durationMs: number; outcome: "http_error"; httpStatus: null }, ProviderAttempt>, false>>;
type LocalFailureRejectsStatus = Assert<Equal<Assignable<{ turn: number; durationMs: number; outcome: "timeout"; httpStatus: number }, ProviderAttempt>, false>>;
type TransportInputHasPostMethod = Assert<Equal<Parameters<ProviderTransport>[0]["method"], "POST">>;
type TransportOutputHasBoundedBody = Assert<Equal<Awaited<ReturnType<ProviderTransport>>, { status: number; body: string | null }>>;

const request: NormalizedProviderRequest = {
  system: "fixture",
  messages: [{ role: "user", content: "hello" }],
  tools: buildToolProtocol(),
};

const transport: ProviderTransport = async ({ method, signal, url, headers, body }) => {
  void [method, signal, url, headers, body];
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
  };
};

const unknownPayload: unknown = { content: "untrusted" };
// @ts-expect-error Untrusted provider data requires runtime narrowing.
const unsafeResponse: NormalizedProviderResponse = unknownPayload;
void unsafeResponse;

async function main(): Promise<void> {
  let callbackRequest: NormalizedProviderRequest | null = null;
  const mock = createMockProvider({
    script: [{ content: "mock", toolCalls: [] }],
    onRequest(requestFromCallback) { callbackRequest = requestFromCallback; },
  });
  await mock.complete(request);
  if (callbackRequest === null) throw new Error("mock callback did not receive a normalized request");

  const adapter = createOpenAICompatibleProvider({
    baseUrl: "https://models.example.test/v1",
    model: "fixture-model",
    apiKeyEnv: "FIXTURE_API_KEY",
    env: { FIXTURE_API_KEY: "fixture-secret" },
    transport,
  });
  const response: NormalizedProviderResponse = await adapter.complete(request);
  if (response.content !== "ok") throw new Error("adapter did not return a normalized response");
  console.log("provider-native-typescript:ok");
}

const compileProof: [AdapterIsProvider, AdapterResponseIsNormalized, HttpFailureRequiresStatus, LocalFailureRejectsStatus, TransportInputHasPostMethod, TransportOutputHasBoundedBody] = [true, true, true, true, true, true];
void compileProof;
void main();
