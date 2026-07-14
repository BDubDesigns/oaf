import { loadAgentContext } from "../../lib/agent/context.ts";
import type {
  AgentContext,
  AgentContextDocument,
  ContextDocumentSource,
  LoadAgentContextOptions,
} from "../../lib/agent/contracts.ts";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

type ContextSignature = Assert<Equal<typeof loadAgentContext, (options: LoadAgentContextOptions) => Promise<AgentContext>>>;
type SourceIsBounded = Assert<Equal<ContextDocumentSource, "workspace" | "docs-pack">>;
type WorkspaceRootIsString = Assert<Equal<AgentContext["workspaceRoot"], string>>;
type DocsPackIdIsString = Assert<Equal<AgentContext["docsPack"]["id"], string>>;
type DocsPackStackIsString = Assert<Equal<AgentContext["docsPack"]["oafStack"], string>>;
type DocumentPathIsString = Assert<Equal<AgentContextDocument["path"], string>>;
type DocumentContentIsString = Assert<Equal<AgentContextDocument["content"], string>>;
type DocumentBytesIsNumber = Assert<Equal<AgentContextDocument["bytes"], number>>;
type TotalBytesIsNumber = Assert<Equal<AgentContext["totalBytes"], number>>;

if (false) {
  const options: LoadAgentContextOptions = { workspaceRoot: "/tmp/workspace" };
  const customRoot: LoadAgentContextOptions = { workspaceRoot: "/tmp/workspace", oafRoot: "/tmp/oaf" };
  const context: Promise<AgentContext> = loadAgentContext(options);
  const document: AgentContextDocument = { source: "workspace", path: "README.md", content: "readme", bytes: 6 };
  const source: ContextDocumentSource = "docs-pack";

  // @ts-expect-error Context loading requires a workspace root.
  const missingWorkspace: LoadAgentContextOptions = {};
  // @ts-expect-error Workspace roots must be strings.
  const numericWorkspace: LoadAgentContextOptions = { workspaceRoot: 1 };
  // @ts-expect-error OAF roots must be strings.
  const numericOafRoot: LoadAgentContextOptions = { workspaceRoot: "/tmp/workspace", oafRoot: 1 };
  // @ts-expect-error Context options reject unrelated fields.
  const unrelatedOption: LoadAgentContextOptions = { workspaceRoot: "/tmp/workspace", docsPack: "stack-0.1" };
  // @ts-expect-error Context document sources use the closed vocabulary.
  const arbitrarySource: AgentContextDocument = { source: "remote", path: "README.md", content: "readme", bytes: 6 };
  // @ts-expect-error Context documents always expose UTF-8 byte counts.
  const missingBytes: AgentContextDocument = { source: "workspace", path: "README.md", content: "readme" };
  // @ts-expect-error Context results always expose aggregate bytes.
  const missingTotalBytes: AgentContext = { workspaceRoot: "/tmp/workspace", docsPack: { id: "stack-0.1", oafStack: "0.1.0" }, documents: [] };
  // @ts-expect-error Context results always expose docs-pack identity.
  const missingDocsPack: AgentContext = { workspaceRoot: "/tmp/workspace", documents: [], totalBytes: 0 };

  void [customRoot, context, document, source, missingWorkspace, numericWorkspace, numericOafRoot, unrelatedOption, arbitrarySource, missingBytes, missingTotalBytes, missingDocsPack];
}

const compileProof: [ContextSignature, SourceIsBounded, WorkspaceRootIsString, DocsPackIdIsString, DocsPackStackIsString, DocumentPathIsString, DocumentContentIsString, DocumentBytesIsNumber, TotalBytesIsNumber] = [true, true, true, true, true, true, true, true, true];
void compileProof;
process.stdout.write("agent-context-native-typescript:ok");
