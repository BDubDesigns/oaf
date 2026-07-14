// Focused test for Alpha 1's workspace-bounded read/list/grep tools.
// Uses only Node built-ins; no third-party dependencies.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeGrep, executeList, executeRead } from "../lib/agent/tool-execution.ts";

let failures = 0;
function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
    console.log(`FAIL  ${message}`);
    failures++;
  }
}

async function rejects(action: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await action();
    assert(false, message);
  } catch (error: unknown) {
    assert(error instanceof Error && pattern.test(error.message), message);
  }
}

const base = mkdtempSync(join(tmpdir(), "oaf-agent-read-tools-"));
const workspace = join(base, "workspace");
const outside = join(base, "outside");
const oneFile = join(workspace, "one.txt");
const outsideFile = join(outside, "secret.txt");

try {
  mkdirSync(join(workspace, "nested"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(oneFile, "first line\nneedle in one\nthird line\n");
  writeFileSync(join(workspace, "nested", "two.txt"), "needle in two\n");
  writeFileSync(join(workspace, "binary.dat"), Buffer.from([0, 110, 101, 101, 100, 108, 101]));
  writeFileSync(outsideFile, "outside needle\n");

  const before = readFileSync(oneFile, "utf8");

  // 1. read supports a full UTF-8 read and 1-based, inclusive line ranges.
  const full = await executeRead({ workspaceRoot: workspace, path: "one.txt" });
  assert(full.path === "one.txt", "read returns the project-relative path");
  assert(full.content === before && full.truncated === false, "read returns full file without truncation");

  const range = await executeRead({
    workspaceRoot: workspace,
    path: "one.txt",
    startLine: 2,
    endLine: 2,
  });
  assert(range.content === "needle in one" && range.truncated === true, "read returns a 1-based line range");

  // 2. list is workspace-bounded and supports a simple recursive view.
  const listing = await executeList({ workspaceRoot: workspace, path: "." });
  assert(listing.path === ".", "list returns the requested project-relative directory");
  assert(
    listing.entries.some((entry) => entry.name === "one.txt" && entry.type === "file") &&
      listing.entries.some((entry) => entry.name === "nested" && entry.type === "directory"),
    "list returns files and directories",
  );

  const recursive = await executeList({ workspaceRoot: workspace, path: ".", recursive: true });
  assert(
    recursive.entries.some((entry) => entry.name === "nested/two.txt" && entry.type === "file"),
    "list recursively returns project-relative descendant paths",
  );

  // 3. grep uses plain substring matching, skips binary files, and supports a small glob.
  const matches = await executeGrep({ workspaceRoot: workspace, pattern: "needle" });
  assert(
    matches.matches.some((match) => match.path === "one.txt" && match.line === 2) &&
      matches.matches.some((match) => match.path === "nested/two.txt" && match.line === 1) &&
      !matches.matches.some((match) => match.path === "binary.dat"),
    "grep finds text matches and skips binary files",
  );

  const rootTextMatches = await executeGrep({ workspaceRoot: workspace, pattern: "needle", glob: "*.txt" });
  assert(
    rootTextMatches.matches.length === 1 && rootTextMatches.matches[0].path === "one.txt",
    "grep glob filters workspace-relative paths",
  );

  // 4. absolute paths and parent traversal fail for every read-only tool.
  await rejects(
    () => executeRead({ workspaceRoot: workspace, path: outsideFile }),
    /requested path is outside the workspace/,
    "read rejects absolute paths",
  );
  await rejects(
    () => executeList({ workspaceRoot: workspace, path: outsideFile }),
    /requested path is outside the workspace/,
    "list rejects absolute paths",
  );
  await rejects(
    () => executeGrep({ workspaceRoot: workspace, pattern: "needle", path: outsideFile }),
    /requested path is outside the workspace/,
    "grep rejects absolute paths",
  );
  await rejects(
    () => executeRead({ workspaceRoot: workspace, path: "../outside/secret.txt" }),
    /requested path is outside the workspace/,
    "read rejects parent traversal",
  );
  await rejects(
    () => executeList({ workspaceRoot: workspace, path: "../outside" }),
    /requested path is outside the workspace/,
    "list rejects parent traversal",
  );
  await rejects(
    () => executeGrep({ workspaceRoot: workspace, pattern: "needle", path: "../outside" }),
    /requested path is outside the workspace/,
    "grep rejects parent traversal",
  );

  // 5. A requested symlink to an external file must not escape the workspace.
  const escape = join(workspace, "escape.txt");
  try {
    symlinkSync(outsideFile, escape);
    await rejects(
      () => executeRead({ workspaceRoot: workspace, path: "escape.txt" }),
      /requested path is outside the workspace/,
      "read rejects symlink escape",
    );
    await rejects(
      () => executeList({ workspaceRoot: workspace, path: "escape.txt" }),
      /requested path is outside the workspace/,
      "list rejects symlink escape",
    );
    await rejects(
      () => executeGrep({ workspaceRoot: workspace, pattern: "needle", path: "escape.txt" }),
      /requested path is outside the workspace/,
      "grep rejects symlink escape",
    );
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
      console.log(`SKIP  symlink escape test unavailable: ${code}`);
    } else {
      throw error;
    }
  }

  // 6. The read-only tools never change fixture files.
  assert(readFileSync(oneFile, "utf8") === before, "read/list/grep do not mutate files");
} finally {
  rmSync(base, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent read-tool checks passed.");
