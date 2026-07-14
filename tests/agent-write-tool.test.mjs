// Focused test for Alpha 1's workspace-bounded whole-file write tool.
// Uses only Node built-ins; no third-party dependencies.
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeWrite } from "../lib/agent/tool-execution.ts";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`);
  } else {
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

const base = mkdtempSync(join(tmpdir(), "oaf-agent-write-tool-"));
const workspace = join(base, "workspace");
const outside = join(base, "outside");
const existingFile = join(workspace, "existing.txt");
const unrelatedFile = join(workspace, "unrelated.txt");
const outsideFile = join(outside, "secret.txt");

try {
  mkdirSync(join(workspace, "existing-dir"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(existingFile, "before\n");
  writeFileSync(unrelatedFile, "leave me alone\n");
  writeFileSync(outsideFile, "outside\n");
  const unrelatedBefore = readFileSync(unrelatedFile, "utf8");

  // 1. New whole-file writes return a project-relative path and UTF-8 bytes.
  const createdContent = "hello 🌍\n";
  const created = await executeWrite({
    workspaceRoot: workspace,
    path: "created.txt",
    content: createdContent,
  });
  assert(
    created.path === "created.txt" && created.bytes === Buffer.byteLength(createdContent, "utf8"),
    "write returns the project-relative path and UTF-8 byte count",
  );
  assert(readFileSync(join(workspace, "created.txt"), "utf8") === createdContent, "write creates a new file");

  // 2. Existing regular files are replaced as whole files.
  const replacement = await executeWrite({
    workspaceRoot: workspace,
    path: "existing.txt",
    content: "after\n",
  });
  assert(replacement.bytes === 6, "write reports byte count for replacement");
  assert(readFileSync(existingFile, "utf8") === "after\n", "write replaces an existing regular file");
  assert(
    !readdirSync(workspace).some((name) => name.includes(".oaf-") && name.endsWith(".tmp")),
    "atomic write leaves no temporary file after success",
  );

  // Atomic replacement must not strip the mode of an existing executable file.
  if (process.platform === "win32") {
    console.log("SKIP  executable permission preservation is not portable on Windows");
  } else {
    const executable = join(workspace, "tool.mjs");
    writeFileSync(executable, "#!/usr/bin/env node\n");
    chmodSync(executable, 0o755);
    await executeWrite({ workspaceRoot: workspace, path: "tool.mjs", content: "export {};\n" });
    assert((statSync(executable).mode & 0o777) === 0o755, "write preserves an existing regular file's permission mode");
  }

  // 3. workspaceRoot and path boundaries fail closed.
  await rejects(
    () => Reflect.apply(executeWrite, undefined, [{ path: "missing-root.txt", content: "x" }]),
    /workspaceRoot is required/,
    "write requires workspaceRoot",
  );
  await rejects(
    () => executeWrite({ workspaceRoot: workspace, path: outsideFile, content: "x" }),
    /requested path is outside the workspace/,
    "write rejects absolute paths",
  );
  await rejects(
    () => executeWrite({ workspaceRoot: workspace, path: "C:\\outside\\blocked.txt", content: "x" }),
    /requested path is outside the workspace/,
    "write rejects Windows-style absolute paths",
  );
  await rejects(
    () => executeWrite({ workspaceRoot: workspace, path: "../outside/blocked.txt", content: "x" }),
    /requested path is outside the workspace/,
    "write rejects parent traversal",
  );

  // 4. Parents must exist and destinations must be regular files.
  await rejects(
    () => executeWrite({ workspaceRoot: workspace, path: "missing/child.txt", content: "x" }),
    /parent directory does not exist/,
    "write rejects a missing parent directory",
  );
  assert(!existsSync(join(workspace, "missing")), "write does not create missing parent directories");
  await rejects(
    () => executeWrite({ workspaceRoot: workspace, path: "existing-dir", content: "x" }),
    /regular file destination/,
    "write rejects a directory destination",
  );

  // 5. File and parent symlinks cannot be used to escape the workspace.
  try {
    symlinkSync(outsideFile, join(workspace, "escape-file.txt"));
    symlinkSync(outside, join(workspace, "escape-parent"), process.platform === "win32" ? "junction" : "dir");
    await rejects(
      () => executeWrite({ workspaceRoot: workspace, path: "escape-file.txt", content: "x" }),
      /does not allow symlink destinations/,
      "write rejects a symlink file destination",
    );
    await rejects(
      () => executeWrite({ workspaceRoot: workspace, path: "escape-parent/child.txt", content: "x" }),
      /parent directory resolves outside the workspace through a symlink/,
      "write rejects a symlink parent escape",
    );
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOTSUP") {
      console.log(`SKIP  symlink write tests unavailable: ${error.code}`);
    } else {
      throw error;
    }
  }

  // 6. A write affects only its requested destination.
  assert(readFileSync(unrelatedFile, "utf8") === unrelatedBefore, "write does not alter unrelated files");
} finally {
  rmSync(base, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll agent write-tool checks passed.");
