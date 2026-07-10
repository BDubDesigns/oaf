// Tiny OAF-owned provider seam for the Alpha 1 agent loop (issue #31).
//
// The loop talks to a model only through this small interface. Alpha 1 ships
// a deterministic scripted mock provider so the loop is fully testable with no
// real model, API key, or network. A later issue adds a real provider behind
// the same seam; nothing else in the loop changes.
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

import { TOOL_NAMES, TOOLS } from "./tools.mjs";

// Build the provider-facing tool protocol from the fixed Alpha 1 registry.
// The loop passes exactly this list; it must not invent a parallel registry.
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
