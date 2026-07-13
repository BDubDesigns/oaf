// Tiny OAF-owned provider seam for the Alpha 1 agent loop (issue #31).
// The loop talks to a model only through this small interface. Alpha 1 ships
// a deterministic scripted mock provider so the loop is fully testable with no
// real model, API key, or network.

import { HTTP_PROVIDER_FAILURE_OUTCOMES, PROVIDER_FAILURE_OUTCOMES, type HttpProviderFailureOutcome, type MockProvider, type MockProviderScript, type NormalizedProviderRequest, type ProviderAttempt, type ProviderCallMetadata, type ProviderFailureOutcome, type ProviderIdentifier, type ProviderToolDefinition, type ProviderUsage } from "./contracts.ts";
import { TOOL_NAMES, TOOLS } from "./tools.ts";

export const MAX_PROVIDER_IDENTIFIER_LENGTH = 64;
export const MAX_MODEL_IDENTIFIER_LENGTH = 128;
const IDENTIFIER_RE = /^[A-Za-z0-9._:/-]+$/;
const VALID_PROVIDER_OUTCOMES = new Set<string>(PROVIDER_FAILURE_OUTCOMES);
const HTTP_FAILURE_OUTCOME_SET = new Set<string>(HTTP_PROVIDER_FAILURE_OUTCOMES);

function isProviderFailureOutcome(value: unknown): value is ProviderFailureOutcome {
  return typeof value === "string" && VALID_PROVIDER_OUTCOMES.has(value);
}

function isHttpProviderFailureOutcome(value: unknown): value is HttpProviderFailureOutcome {
  return typeof value === "string" && HTTP_FAILURE_OUTCOME_SET.has(value);
}

export class ProviderFailure extends Error {
  readonly outcome: ProviderFailureOutcome;
  readonly httpStatus: number | null;

  constructor(outcome: unknown, options: { httpStatus?: unknown; cause?: unknown } = {}) {
    const validatedOutcome: ProviderFailureOutcome = isProviderFailureOutcome(outcome) ? outcome : "unknown_provider_error";
    const validatedStatus = typeof options.httpStatus === "number" && Number.isInteger(options.httpStatus) && options.httpStatus >= 100 && options.httpStatus <= 599
      ? options.httpStatus
      : null;
    super(validatedOutcome);
    this.outcome = validatedOutcome;
    this.httpStatus = validatedStatus;
    Object.defineProperty(this, "message", { value: validatedOutcome, enumerable: false, writable: true, configurable: true });
    Object.defineProperty(this, "name", { value: "ProviderFailure", enumerable: false, writable: true, configurable: true });
    if (options.cause !== undefined) {
      Object.defineProperty(this, "_cause", { value: options.cause, enumerable: false, writable: true, configurable: true });
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueFor(object: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

// ProviderFailure preserves its bounded transport payload for callers. Durable
// attempts additionally require a truthful status/outcome pairing.
export function normalizeProviderAttempt(attempt: unknown, fallbackTurn = 1): ProviderAttempt {
  const object = isPlainObject(attempt) ? attempt : null;
  const turnValue = object === null ? undefined : valueFor(object, "turn");
  const durationValue = object === null ? undefined : valueFor(object, "durationMs");
  const outcomeValue = object === null ? undefined : valueFor(object, "outcome");
  const httpStatusValue = object === null ? undefined : valueFor(object, "httpStatus");
  const turn = typeof turnValue === "number" && Number.isSafeInteger(turnValue) && turnValue >= 1 ? turnValue : fallbackTurn;
  const durationMs = typeof durationValue === "number" && Number.isSafeInteger(durationValue) && durationValue >= 0 ? durationValue : 0;
  const outcome = outcomeValue === "success" || isProviderFailureOutcome(outcomeValue) ? outcomeValue : "unknown_provider_error";
  const httpStatus = typeof httpStatusValue === "number" && Number.isInteger(httpStatusValue) && httpStatusValue >= 100 && httpStatusValue <= 599 ? httpStatusValue : null;
  if (outcome === "success") return { turn, durationMs, outcome, httpStatus: null };
  if (isHttpProviderFailureOutcome(outcome)) {
    return httpStatus === null
      ? { turn, durationMs, outcome: "unknown_provider_error", httpStatus: null }
      : { turn, durationMs, outcome, httpStatus };
  }
  return { turn, durationMs, outcome, httpStatus: null };
}

// Return a trimmed identifier when it is bounded and safe for durable metadata;
// otherwise return null. Slashes permit common namespaced model identifiers.
export function normalizeProviderIdentifier(value: unknown, maxLength = MAX_PROVIDER_IDENTIFIER_LENGTH): ProviderIdentifier | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength || !IDENTIFIER_RE.test(normalized)) return null;
  return normalized;
}

function invalidMetadata(): never {
  throw new ProviderFailure("invalid_response");
}

function validateUsage(usage: unknown): ProviderUsage {
  if (!isPlainObject(usage)) invalidMetadata();
  const fields: readonly (keyof ProviderUsage)[] = ["inputTokens", "outputTokens", "totalTokens"];
  for (const key of Object.keys(usage)) if (!new Set<string>(fields).has(key)) invalidMetadata();
  const output: ProviderUsage = { inputTokens: null, outputTokens: null, totalTokens: null };
  for (const field of fields) {
    if (!Object.hasOwn(usage, field)) invalidMetadata();
    const value = usage[field];
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) invalidMetadata();
    output[field] = value;
  }
  return output;
}

// Validate the exact cross-provider metadata shape before the loop retains it.
export function validateProviderCall(call: unknown): ProviderCallMetadata {
  if (!isPlainObject(call)) invalidMetadata();
  const fields: readonly (keyof ProviderCallMetadata)[] = ["provider", "requestedModel", "reportedModel", "usage"];
  for (const key of Object.keys(call)) if (!new Set<string>(fields).has(key)) invalidMetadata();
  for (const field of fields) {
    if (!Object.hasOwn(call, field)) invalidMetadata();
  }
  const provider = normalizeProviderIdentifier(call.provider);
  if (provider === null) invalidMetadata();
  const requestedModel = normalizeProviderIdentifier(call.requestedModel, MAX_MODEL_IDENTIFIER_LENGTH);
  if (requestedModel === null) invalidMetadata();
  const reportedModel = call.reportedModel === null ? null : normalizeProviderIdentifier(call.reportedModel, MAX_MODEL_IDENTIFIER_LENGTH);
  if (call.reportedModel !== null && reportedModel === null) invalidMetadata();
  return { provider, requestedModel, reportedModel, usage: validateUsage(call.usage) };
}

// Build the provider-facing tool protocol from the fixed Alpha 1 registry.
export function buildToolProtocol(): ProviderToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name: TOOLS[name].name,
    description: TOOLS[name].description,
    argsSchema: TOOLS[name].argsSchema,
  }));
}

export interface MockProviderOptions { script?: MockProviderScript; onRequest?: (request: NormalizedProviderRequest, callCount: number) => void; }

// Deterministic scripted provider for tests. Neither form touches the network
// or an API key.
export function createMockProvider({ script, onRequest }: MockProviderOptions = {}): MockProvider {
  if (typeof script !== "function" && !Array.isArray(script)) {
    throw new Error("createMockProvider requires a script function or array");
  }

  const queue = Array.isArray(script) ? [...script] : null;
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    get remaining() { return queue === null ? Infinity : queue.length; },
    async complete(request: NormalizedProviderRequest): Promise<unknown> {
      callCount++;
      onRequest?.(request, callCount);
      if (queue !== null) {
        if (queue.length === 0) {
          throw new Error(`mock provider exhausted after ${callCount - 1} call(s); no scripted response for turn ${callCount}`);
        }
        return queue.shift();
      }
      if (typeof script === "function") return script(request, callCount);
      throw new Error("createMockProvider requires a script function or array");
    },
  };
}
