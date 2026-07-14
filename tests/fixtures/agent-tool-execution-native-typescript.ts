import {
  createCommandExecutor,
  executeCommand,
  executeGrep,
  executeList,
  executeRead,
  executeWrite,
  type TrustedWorkspaceFileWrite,
  type TrustedWorkspaceFileWriteResult,
  writeWorkspaceFile,
} from "../../lib/agent/tool-execution.ts";
import type { ToolExecutorMap, ToolExecutorResults } from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type ReadMatchesContract = Assert<Equal<typeof executeRead, ToolExecutorMap["read"]>>;
type ListMatchesContract = Assert<Equal<typeof executeList, ToolExecutorMap["list"]>>;
type GrepMatchesContract = Assert<Equal<typeof executeGrep, ToolExecutorMap["grep"]>>;
type WriteMatchesContract = Assert<Equal<typeof executeWrite, ToolExecutorMap["write"]>>;
type CommandMatchesContract = Assert<Equal<typeof executeCommand, ToolExecutorMap["command"]>>;
type FactoryReturnsContract = Assert<Equal<ReturnType<typeof createCommandExecutor>, ToolExecutorMap["command"]>>;
type TrustedWriterInput = Assert<Equal<Parameters<typeof writeWorkspaceFile>[0], TrustedWorkspaceFileWrite>>;
type TrustedWriterResult = Assert<Equal<Awaited<ReturnType<typeof writeWorkspaceFile>>, TrustedWorkspaceFileWriteResult>>;

async function proveToolExecutionContracts(trustedWrite: TrustedWorkspaceFileWrite): Promise<void> {
  const read = executeRead({ workspaceRoot: ".", path: "README.md" });
  const list = executeList({ workspaceRoot: ".", path: ".", recursive: true });
  const grep = executeGrep({ workspaceRoot: ".", pattern: "OAF" });
  const write = executeWrite({ workspaceRoot: ".", path: "notes.txt", content: "note" });
  const command = executeCommand({ workspaceRoot: ".", command: "pnpm test", mode: "test" });
  const trusted = writeWorkspaceFile(trustedWrite);
  const commandExecutor: ToolExecutorMap["command"] = createCommandExecutor();
  const writeResult: Promise<ToolExecutorResults["write"]> = trusted;
  const readPath: string = (await read).path;
  const readContent: string = (await read).content;
  const readTruncated: boolean = (await read).truncated;
  const listEntryType: string | undefined = (await list).entries[0]?.type;
  const grepPath: string | undefined = (await grep).matches[0]?.path;
  const grepLine: number | undefined = (await grep).matches[0]?.line;
  const grepText: string | undefined = (await grep).matches[0]?.text;
  const writePath: string = (await write).path;
  const writeBytes: number = (await write).bytes;
  const commandExitCode: number | null = (await command).exitCode;
  const commandStdout: string = (await command).stdout;
  const commandStderr: string = (await command).stderr;
  const commandTruncated: boolean = (await command).truncated;

  // @ts-expect-error Agent writes require content.
  void executeWrite({ workspaceRoot: ".", path: "notes.txt" });
  // @ts-expect-error Agent writes cannot carry an arbitrary output path.
  void executeWrite({ workspaceRoot: ".", path: "notes.txt", content: "note", outputPath: "elsewhere" });
  // @ts-expect-error Agent writes cannot carry authorization claims.
  void executeWrite({ workspaceRoot: ".", path: "notes.txt", content: "note", approvalGranted: true });
  // @ts-expect-error Agent commands only accept the fixed sandbox modes.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", mode: "unsafe" });
  // @ts-expect-error Agent commands cannot choose provenance.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", origin: "human_cli" });
  // @ts-expect-error Agent commands cannot self-approve.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", approvalGranted: true });
  // @ts-expect-error Agent commands cannot grant network access.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", networkGranted: true });
  // @ts-expect-error Agent commands cannot inject sandbox dependencies.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", dependencies: {} });
  // @ts-expect-error Agent commands cannot inject callbacks.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", onStdout() {} });
  // @ts-expect-error Agent commands cannot select a container runtime.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", runtime: "docker" });
  // @ts-expect-error Agent commands cannot control mounts.
  void executeCommand({ workspaceRoot: ".", command: "pnpm test", mounts: [] });
  // @ts-expect-error Trusted writes still require an explicit workspace root.
  void writeWorkspaceFile({ path: "oaf/receipt.json", content: "{}" });
  // @ts-expect-error Tool results do not expose raw filesystem exceptions.
  const readWithCause: ToolExecutorResults["read"] = { path: "README.md", content: "", truncated: false, cause: new Error("raw") };
  // @ts-expect-error Command results do not expose sandbox internals.
  const commandWithRuntime: ToolExecutorResults["command"] = { exitCode: 0, stdout: "", stderr: "", truncated: false, runtime: "docker" };

  void [read, list, grep, write, command, trusted, commandExecutor, writeResult, readPath, readContent, readTruncated, listEntryType, grepPath, grepLine, grepText, writePath, writeBytes, commandExitCode, commandStdout, commandStderr, commandTruncated, readWithCause, commandWithRuntime];
}

const compileProof: [ReadMatchesContract, ListMatchesContract, GrepMatchesContract, WriteMatchesContract, CommandMatchesContract, FactoryReturnsContract, TrustedWriterInput, TrustedWriterResult] = [true, true, true, true, true, true, true, true];
void [compileProof, proveToolExecutionContracts];
