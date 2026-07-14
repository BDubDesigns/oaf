import {
  SANDBOX_MODES,
  SandboxError,
  buildContainerRun,
  classifyCommand,
  createVerificationWorkspace,
  detectRuntime,
  runAgentSandboxCommand,
  runHumanSandboxCommand,
  runSandboxCommand,
  verifyPackageScript,
} from "../../lib/sandbox.ts";
import {
  SANDBOX_MODES as CONTRACT_SANDBOX_MODES,
  type AgentAuthorization,
  type AgentSandboxCommandOptions,
  type CommandClassification,
  type ContainerStartRecord,
  type HumanCliAuthorization,
  type HumanSandboxCommandOptions,
  type PackageScriptVerification,
  type SandboxCommandOptions,
  type SandboxDependencies,
  type SandboxExecutionCallbacks,
  type SandboxExecutionResult,
  type VerificationWorkspace,
} from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type SandboxErrorCode = "PACKAGE_SCRIPT_POLICY" | "SANDBOX_START_FAILED" | "INVALID_MODE" | "INVALID_ORIGIN" | "AGENT_COMMAND_DENIED" | "POLICY_REJECTED" | "AGENT_NETWORK_DENIED" | "AGENT_AUTHORIZATION_REQUIRED" | "SANDBOX_UNAVAILABLE" | "INVALID_AGENT_ARGUMENT";
type ModesMatchContracts = Assert<Equal<typeof SANDBOX_MODES, typeof CONTRACT_SANDBOX_MODES>>;
type ErrorCodeIsExact = Assert<Equal<SandboxError["code"], SandboxErrorCode>>;
type ClassificationSignature = Assert<Equal<typeof classifyCommand, (command: string) => CommandClassification>>;
type RuntimeSignature = Assert<Equal<typeof detectRuntime, () => "docker" | "podman" | null>>;
type ContainerSignature = Assert<Equal<typeof buildContainerRun, (runtime: string, options: { command: string; network?: boolean; cwd: string; readOnly?: boolean; nodeModules?: string | null }) => string[]>>;
type PackageVerificationSignature = Assert<Equal<typeof verifyPackageScript, (workspaceRoot: string, command: string) => Promise<PackageScriptVerification>>>;
type WorkspaceSignature = Assert<Equal<typeof createVerificationWorkspace, (workspaceRoot: string) => Promise<VerificationWorkspace>>>;
type AgentSignature = Assert<Equal<typeof runAgentSandboxCommand, (options?: AgentSandboxCommandOptions) => Promise<SandboxExecutionResult>>>;
type HumanSignature = Assert<Equal<typeof runHumanSandboxCommand, (options?: HumanSandboxCommandOptions) => Promise<SandboxExecutionResult>>>;
type GenericSignature = Assert<Equal<typeof runSandboxCommand, (options: SandboxCommandOptions) => Promise<SandboxExecutionResult>>>;

if (false) {
const classification: CommandClassification = classifyCommand("pnpm test");
const runtime: "docker" | "podman" | null = detectRuntime();
const argv: string[] = buildContainerRun("docker", { command: "pnpm test", cwd: "/tmp/workspace" });
const verification: Promise<PackageScriptVerification> = verifyPackageScript("/tmp/workspace", "pnpm test");
const workspace: Promise<VerificationWorkspace> = createVerificationWorkspace("/tmp/workspace");
const callbacks: SandboxExecutionCallbacks = { onStart: (record: ContainerStartRecord) => void record, onStdout: (chunk: Buffer) => void chunk, onStderr: (chunk: Buffer) => void chunk };
const dependencies: SandboxDependencies = { detectRuntime: () => "docker", createVerificationWorkspace, runContainer: async () => ({ exitCode: 0, stdout: "", stderr: "", truncated: false }) };
const agentOptions: AgentSandboxCommandOptions = { command: "git status", ...callbacks, dependencies };
const humanOptions: HumanSandboxCommandOptions = { command: "pnpm test", approvalGranted: true, networkGranted: false, ...callbacks, dependencies };
const genericOptions: SandboxCommandOptions = { command: "git status", origin: "agent", approvalGranted: false, networkGranted: false, ...callbacks, dependencies };
const agentResult: Promise<SandboxExecutionResult> = runAgentSandboxCommand(agentOptions);
const humanResult: Promise<SandboxExecutionResult> = runHumanSandboxCommand(humanOptions);
const genericResult: Promise<SandboxExecutionResult> = runSandboxCommand(genericOptions);
const agentAuthorization: AgentAuthorization = { origin: "agent", approvalGranted: false, networkGranted: false };
const humanAuthorization: HumanCliAuthorization = { origin: "human_cli", approvalGranted: true, networkGranted: false };

// @ts-expect-error Agent callers cannot choose a command origin.
const agentOrigin: AgentSandboxCommandOptions = { command: "git status", origin: "human_cli" };
// @ts-expect-error Agent callers cannot grant approval.
const agentApproval: AgentSandboxCommandOptions = { command: "git status", approvalGranted: true };
// @ts-expect-error Agent callers cannot grant network access.
const agentNetwork: AgentSandboxCommandOptions = { command: "git status", networkGranted: true };
// @ts-expect-error Agent callers cannot add host mounts.
const agentMount: AgentSandboxCommandOptions = { command: "git status", mounts: ["/:/workspace"] };
// @ts-expect-error Agent callers cannot choose direct argv.
const agentArgv: AgentSandboxCommandOptions = { command: "git status", argv: ["sh"] };
// @ts-expect-error Agent callers cannot select a container runtime.
const agentRuntime: AgentSandboxCommandOptions = { command: "git status", runtime: "podman" };
// @ts-expect-error Agent callers cannot select a container image.
const agentImage: AgentSandboxCommandOptions = { command: "git status", image: "untrusted" };
// @ts-expect-error Agent authorization grants are permanently false.
const grantedAgentAuthorization: AgentAuthorization = { origin: "agent", approvalGranted: true, networkGranted: false };
// @ts-expect-error Human authorization requires human_cli provenance.
const wrongHumanAuthorization: HumanCliAuthorization = { origin: "agent", approvalGranted: true, networkGranted: true };
// @ts-expect-error Sandbox results do not expose a child process.
const rawChildResult: SandboxExecutionResult = { exitCode: 0, stdout: "", stderr: "", truncated: false, child: process };
// @ts-expect-error Sandbox results do not expose internal errors.
const rawErrorResult: SandboxExecutionResult = { exitCode: 0, stdout: "", stderr: "", truncated: false, error: new Error("internal") };

void [classification, runtime, argv, verification, workspace, agentResult, humanResult, genericResult, agentAuthorization, humanAuthorization, agentOrigin, agentApproval, agentNetwork, agentMount, agentArgv, agentRuntime, agentImage, grantedAgentAuthorization, wrongHumanAuthorization, rawChildResult, rawErrorResult];
}

const compileProof: [ModesMatchContracts, ErrorCodeIsExact, ClassificationSignature, RuntimeSignature, ContainerSignature, PackageVerificationSignature, WorkspaceSignature, AgentSignature, HumanSignature, GenericSignature] = [true, true, true, true, true, true, true, true, true, true];
void compileProof;
process.stdout.write("sandbox-native-typescript:ok");
