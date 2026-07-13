// Tiny OAF-owned provider seam for the Alpha 1 agent loop (issue #31).
//
// The loop talks to a model only through this small interface. Alpha 1 ships
// a deterministic scripted mock provider so the loop is fully testable with no
// real model, API key, or network. The real adapter lives in its own module
// behind the same seam; nothing else in the loop changes.
//
// Provider contract (the whole protocol):
//
//   A provider is an object exposing one async method:
//     complete(request) -> response
//
//   request = {
//     system:   string,                                    // assembled OAF context
//     messages: Array<{ role, content, toolCalls?, toolResults? }>,
//     tools:    Array<{ name, description, argsSchema }>,  // fixed registry from tools.mjs
//   }
//
//   response = {
//     content:   string | null,                                  // assistant text
//     toolCalls: Array<{ id: string, name: string, args: object }>,  // empty => terminal
//   }
//
// Terminal condition: a response whose `toolCalls` array is empty ends the run.
// The loop never streams, never compacts context, and never contacts a model
// directly — it only calls `complete()`.

/** @typedef {import("./contracts.ts").Provider} Provider */

import { TOOL_NAMES, TOOLS } from "./tools.ts";
import { HTTP_PROVIDER_FAILURE_OUTCOMES, PROVIDER_FAILURE_OUTCOMES } from "./contracts.ts";

// Generic provider-result metadata contract. This is protocol-neutral: it has
// no knowledge of credentials, HTTP, or any concrete provider wire format.
export const MAX_PROVIDER_IDENTIFIER_LENGTH = 64;
export const MAX_MODEL_IDENTIFIER_LENGTH = 128;
const IDENTIFIER_RE = /^[A-Za-z0-9._:/-]+$/;

/** @type {Set<string>} */
const VALID_PROVIDER_OUTCOMES = new Set(PROVIDER_FAILURE_OUTCOMES);
/** @type {Set<string>} */
const HTTP_FAILURE_OUTCOME_SET = new Set(HTTP_PROVIDER_FAILURE_OUTCOMES);

/** @param {unknown} value @returns {value is import("./contracts.ts").ProviderFailureOutcome} */
function isProviderFailureOutcome(value) {
  return typeof value === "string" && VALID_PROVIDER_OUTCOMES.has(value);
}

/** @param {unknown} value @returns {value is import("./contracts.ts").HttpProviderFailureOutcome} */
function isHttpProviderFailureOutcome(value) {
  return typeof value === "string" && HTTP_FAILURE_OUTCOME_SET.has(value);
}

export class ProviderFailure extends Error {
  constructor(outcome, { httpStatus, cause } = {}) {
    const validatedOutcome = VALID_PROVIDER_OUTCOMES.has(outcome) ? outcome : "unknown_provider_error";
    const validatedStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    super(validatedOutcome);
    this.outcome = validatedOutcome;
    this.httpStatus = validatedStatus;
    Object.defineProperty(this, "message", { value: validatedOutcome, enumerable: false, writable: true, configurable: true });
    Object.defineProperty(this, "name", { value: "ProviderFailure", enumerable: false, writable: true, configurable: true });
    if (cause !== undefined) {
      Object.defineProperty(this, "_cause", { value: cause, enumerable: false, writable: true, configurable: true });
    }
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ProviderFailure preserves its bounded transport payload for callers. Durable
// attempts additionally require a truthful status/outcome pairing.
/** @param {unknown} attempt @param {number} fallbackTurn @returns {import("./contracts.ts").ProviderAttempt} */
export function normalizeProviderAttempt(attempt, fallbackTurn = 1) {
  const turnValue = isPlainObject(attempt) && Object.hasOwn(attempt, "turn") ? attempt.turn : undefined;
  const durationValue = isPlainObject(attempt) && Object.hasOwn(attempt, "durationMs") ? attempt.durationMs : undefined;
  const outcomeValue = isPlainObject(attempt) && Object.hasOwn(attempt, "outcome") ? attempt.outcome : undefined;
  const httpStatusValue = isPlainObject(attempt) && Object.hasOwn(attempt, "httpStatus") ? attempt.httpStatus : undefined;
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
export function normalizeProviderIdentifier(value, maxLength = MAX_PROVIDER_IDENTIFIER_LENGTH) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength || !IDENTIFIER_RE.test(normalized)) return null;
  return normalized;
}

function invalidMetadata(reason) {
  throw new ProviderFailure("invalid_response");
}

function validateUsage(usage) {
  if (!isPlainObject(usage)) invalidMetadata("usage must be an object");
  const fields = new Set(["inputTokens", "outputTokens", "totalTokens"]);
  for (const key of Object.keys(usage)) {
    if (!fields.has(key)) invalidMetadata("usage has an unsupported field");
  }
  const output = {};
  for (const field of fields) {
    if (!Object.hasOwn(usage, field)) invalidMetadata("usage is incomplete");
    const value = usage[field];
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      invalidMetadata("usage values must be nonnegative integers or null");
    }
    output[field] = value;
  }
  return output;
}

// Validate the exact cross-provider metadata shape before the loop retains it.
// requestedModel must be a safe configured identifier; reportedModel may be
// null when a provider omits or rejects its untrusted reported value.
export function validateProviderCall(call) {
  if (!isPlainObject(call)) invalidMetadata("providerCall must be an object");
  const fields = new Set(["provider", "requestedModel", "reportedModel", "usage"]);
  for (const key of Object.keys(call)) {
    if (!fields.has(key)) invalidMetadata("providerCall has an unsupported field");
  }
  for (const field of fields) {
    if (!Object.hasOwn(call, field)) invalidMetadata("providerCall is incomplete");
  }
  const provider = normalizeProviderIdentifier(call.provider);
  if (provider === null) invalidMetadata("provider is invalid");
  const requestedModel = normalizeProviderIdentifier(call.requestedModel, MAX_MODEL_IDENTIFIER_LENGTH);
  if (requestedModel === null) invalidMetadata("requestedModel is invalid");
  const reportedModel = call.reportedModel === null
    ? null
    : normalizeProviderIdentifier(call.reportedModel, MAX_MODEL_IDENTIFIER_LENGTH);
  if (call.reportedModel !== null && reportedModel === null) invalidMetadata("reportedModel is invalid");
  return { provider, requestedModel, reportedModel, usage: validateUsage(call.usage) };
}

// Build the provider-facing tool protocol from the fixed Alpha 1 registry.
// The loop passes exactly this list; it must not invent a parallel registry.
/** @returns {import("./contracts.ts").ProviderToolDefinition[]} */
export function buildToolProtocol() {
  return TOOL_NAMES.map((name) => ({
    name: TOOLS[name].name,
    description: TOOLS[name].description,
    argsSchema: TOOLS[name].argsSchema,
  }));
}

// Deterministic scripted provider for tests. `script` is either:
//   - an array of responses (consumed in order; exhaustion throws), or
//   - a function (request, callCount) => response (called every turn).
// `onRequest` is an optional observer (request, callCount) for assertions.
// Neither form touches the network or an API key.
export function createMockProvider({ script, onRequest } = {}) {
  if (typeof script !== "function" && !Array.isArray(script)) {
    throw new Error("createMockProvider requires a script function or array");
  }

  const queue = Array.isArray(script) ? [...script] : null;
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    get remaining() {
      return queue ? queue.length : Infinity;
    },
    async complete(request) {
      callCount++;
      if (onRequest) onRequest(request, callCount);
      let response;
      if (queue) {
        if (queue.length === 0) {
          throw new Error(
            `mock provider exhausted after ${callCount - 1} call(s); no scripted response for turn ${callCount}`,
          );
        }
        response = queue.shift();
      } else {
        response = script(request, callCount);
      }
      return response;
    },
  };
}
