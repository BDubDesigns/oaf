import {
  AGENT_PATH_DENIED_MESSAGE,
  AgentPathDeniedError,
  assertAgentReadablePath,
  assertAgentWritablePath,
  isAgentReadablePath,
  isAgentWritablePath,
  isProtectedAgentPath,
  shouldHideFromAgentTraversal,
} from "../../lib/agent/path-policy.ts";
import { AgentToolError, PUBLIC_TOOL_ERRORS, publicToolError } from "../../lib/agent/tool-errors.ts";
import { TOOL_ERROR_MESSAGES, type PublicToolError, type ToolErrorCode } from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type DeniedMessageIsExact = Assert<Equal<typeof AGENT_PATH_DENIED_MESSAGE, "requested project path is not available to the agent">>;
type DeniedCodeIsExact = Assert<Equal<AgentPathDeniedError["code"], "AGENT_PATH_DENIED">>;
type ProtectedPathSignature = Assert<Equal<typeof isProtectedAgentPath, (path: string) => boolean>>;
type ReadablePathSignature = Assert<Equal<typeof isAgentReadablePath, (path: string) => boolean>>;
type WritablePathSignature = Assert<Equal<typeof isAgentWritablePath, (path: string) => boolean>>;
type TraversalPathSignature = Assert<Equal<typeof shouldHideFromAgentTraversal, (path: string) => boolean>>;
type ReadAssertionSignature = Assert<Equal<typeof assertAgentReadablePath, (...paths: string[]) => void>>;
type WriteAssertionSignature = Assert<Equal<typeof assertAgentWritablePath, (...paths: string[]) => void>>;
type PublicErrorsAreCanonical = Assert<Equal<typeof PUBLIC_TOOL_ERRORS, typeof TOOL_ERROR_MESSAGES>>;
type AgentToolErrorCodeIsCanonical = Assert<Equal<AgentToolError["code"], ToolErrorCode>>;
type PublicToolErrorInputIsUnknown = Assert<Equal<Parameters<typeof publicToolError>[0], unknown>>;
type PublicToolErrorOutputIsCanonical = Assert<Equal<ReturnType<typeof publicToolError>, PublicToolError>>;

const pathResult: boolean = isProtectedAgentPath(".env");
const readableResult: boolean = isAgentReadablePath("app/source.ts");
const writableResult: boolean = isAgentWritablePath("app/source.ts");
const traversalResult: boolean = shouldHideFromAgentTraversal(".env");
const readableAssertion: void = assertAgentReadablePath("app/source.ts");
const writableAssertion: void = assertAgentWritablePath("app/source.ts");
const toolError = new AgentToolError("PATH_NOT_FOUND");
const toolCode: ToolErrorCode = toolError.code;
const publicError: PublicToolError = publicToolError({ code: "ENOENT", path: "/private/workspace" });

// @ts-expect-error Normal typed callers cannot supply an unknown tool-error code.
void new AgentToolError("BOGUS");
// @ts-expect-error Path-policy APIs require a string path.
void isProtectedAgentPath(42);
// @ts-expect-error Public errors cannot expose arbitrary filesystem paths.
const publicErrorWithPath: PublicToolError = { code: "PATH_NOT_FOUND", message: "requested path does not exist", path: "/private/workspace" };
// @ts-expect-error Public errors cannot expose internal causes.
const publicErrorWithCause: PublicToolError = { code: "PATH_NOT_FOUND", message: "requested path does not exist", cause: new Error("private") };
// @ts-expect-error Public errors cannot expose stacks.
const publicErrorWithStack: PublicToolError = { code: "PATH_NOT_FOUND", message: "requested path does not exist", stack: "private" };
// @ts-expect-error Public errors reject noncanonical codes.
const publicErrorWithBogusCode: PublicToolError = { code: "BOGUS", message: "tool execution failed" };

const compileProof: [DeniedMessageIsExact, DeniedCodeIsExact, ProtectedPathSignature, ReadablePathSignature, WritablePathSignature, TraversalPathSignature, ReadAssertionSignature, WriteAssertionSignature, PublicErrorsAreCanonical, AgentToolErrorCodeIsCanonical, PublicToolErrorInputIsUnknown, PublicToolErrorOutputIsCanonical] = [true, true, true, true, true, true, true, true, true, true, true, true];
void [compileProof, pathResult, readableResult, writableResult, traversalResult, readableAssertion, writableAssertion, toolCode, publicError, publicErrorWithPath, publicErrorWithCause, publicErrorWithStack, publicErrorWithBogusCode];
process.stdout.write("agent-path-tool-errors-native-typescript:ok");
