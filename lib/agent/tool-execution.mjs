// In-process execution for Alpha 1's workspace-bounded agent file tools.
//
// These tools are deliberately separate from lib/agent/tools.mjs, which is
// the metadata-only registry. All functions require an explicit workspaceRoot
// and use Node built-ins only; none execute shell commands or access the
// network.

import { chmod, lstat, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { runAgentSandboxCommand, SANDBOX_MODES } from "../sandbox.mjs";
import { assertAgentReadablePath, assertAgentWritablePath, shouldHideFromAgentTraversal } from "./path-policy.mjs";

function isInsideWorkspace(workspaceRoot, target) {
  const pathFromRoot = relative(workspaceRoot, target);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function outputPath(workspaceRoot, target) {
  return (relative(workspaceRoot, target) || ".").split(sep).join("/");
}

function validateProjectPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty project-relative string");
  }
  if (isAbsolute(path) || win32.isAbsolute(path)) {
    throw new Error("absolute paths are not allowed");
  }
  if (path.split(/[\\/]+/).includes("..")) {
    throw new Error("parent traversal is not allowed");
  }
}

async function resolveWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new Error("workspaceRoot is required");
  }

  const root = await realpath(workspaceRoot);
  if (!(await stat(root)).isDirectory()) {
    throw new Error("workspaceRoot must be a directory");
  }
  return root;
}

async function resolveWorkspacePath(workspaceRoot, path) {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  validateProjectPath(path);

  const requested = resolve(root, path);
  if (!isInsideWorkspace(root, requested)) {
    throw new Error("path resolves outside the workspace");
  }

  // realpath follows links before the boundary check, so a link to /tmp (or
  // any other parent/external path) cannot be used to escape the project.
  const target = await realpath(requested);
  if (!isInsideWorkspace(root, target)) {
    throw new Error("path resolves outside the workspace through a symlink");
  }

  return { root, target, path: outputPath(root, requested) };
}

async function resolveWriteDestination(workspaceRoot, path) {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  validateProjectPath(path);

  const requested = resolve(root, path);
  if (!isInsideWorkspace(root, requested)) {
    throw new Error("path resolves outside the workspace");
  }

  let parent;
  try {
    parent = await realpath(dirname(requested));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("parent directory does not exist");
    }
    throw error;
  }

  // New files cannot be realpathed yet. Validate the real parent first, then
  // construct the destination beneath that verified directory.
  if (!isInsideWorkspace(root, parent)) {
    throw new Error("parent directory resolves outside the workspace through a symlink");
  }
  if (!(await stat(parent)).isDirectory()) {
    throw new Error("parent path must be a directory");
  }

  return {
    root,
    parent,
    destination: join(parent, basename(requested)),
    path: outputPath(root, requested),
  };
}

async function verifyExistingWriteDestination(destination, workspaceRoot) {
  try {
    const destinationStat = await lstat(destination);
    if (destinationStat.isSymbolicLink()) {
      throw new Error("write does not allow symlink destinations");
    }
    if (!destinationStat.isFile()) {
      throw new Error("write requires a regular file destination");
    }

    const resolvedDestination = await realpath(destination);
    if (!isInsideWorkspace(workspaceRoot, resolvedDestination)) {
      throw new Error("destination resolves outside the workspace");
    }

    // Preserve the existing permission mode when its inode is atomically
    // replaced below. Strip only the file-type bits before chmod.
    return destinationStat.mode & 0o7777;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeAtomically(parent, destination, content, existingMode) {
  let temporary;
  let temporaryCreated = false;

  try {
    // A UUID collision is exceptionally unlikely; retry a few times so the
    // temporary name is still exclusive if one does occur.
    for (let attempt = 0; attempt < 3; attempt++) {
      temporary = join(parent, `.${basename(destination)}.oaf-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
        temporaryCreated = true;
        if (existingMode !== undefined) {
          await chmod(temporary, existingMode);
        }
        break;
      } catch (error) {
        if (error.code !== "EEXIST" || attempt === 2) throw error;
      }
    }

    await rename(temporary, destination);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) {
      await unlink(temporary).catch(() => {});
    }
  }
}

function validateLineNumber(value, name) {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function linesFrom(content) {
  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

// Read a UTF-8 file inside workspaceRoot. Line ranges are 1-based and
// inclusive. A full read preserves file contents; a range normalizes line
// endings to \n in its returned slice.
export async function executeRead({ workspaceRoot, path, startLine, endLine }) {
  validateLineNumber(startLine, "startLine");
  validateLineNumber(endLine, "endLine");
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    throw new Error("endLine must be greater than or equal to startLine");
  }

  const resolved = await resolveWorkspacePath(workspaceRoot, path);
  assertAgentReadablePath(resolved.path, outputPath(resolved.root, resolved.target));
  if (!(await stat(resolved.target)).isFile()) {
    throw new Error("read requires a file path");
  }

  const content = await readFile(resolved.target, "utf8");
  if (startLine === undefined && endLine === undefined) {
    return { path: resolved.path, content, truncated: false };
  }

  const lines = linesFrom(content);
  const first = startLine ?? 1;
  if (first > lines.length) {
    throw new Error("startLine is outside the file");
  }
  const last = Math.min(endLine ?? lines.length, lines.length);
  return {
    path: resolved.path,
    content: lines.slice(first - 1, last).join("\n"),
    truncated: first > 1 || last < lines.length,
  };
}

// Write a complete UTF-8 file inside workspaceRoot. The parent directory must
// already exist. New files are allowed; existing destinations must be regular
// files, never symlinks. Writes use a temporary sibling plus rename so the
// destination is replaced atomically within its verified parent directory.
export async function writeWorkspaceFile({ workspaceRoot, path, content }) {
  if (typeof content !== "string") {
    throw new Error("content must be a string");
  }

  const resolved = await resolveWriteDestination(workspaceRoot, path);
  const existingMode = await verifyExistingWriteDestination(resolved.destination, resolved.root);
  await writeAtomically(resolved.parent, resolved.destination, content, existingMode);

  return {
    path: resolved.path,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

export async function executeWrite({ workspaceRoot, path, content }) {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  validateProjectPath(path);
  assertAgentWritablePath(outputPath(root, resolve(root, path)));
  return writeWorkspaceFile({ workspaceRoot: root, path, content });
}

// Factory is a narrow dependency-injection seam for focused tests. Production
// code uses the exported executeCommand below, which is permanently bound to
// the shared OAF sandbox runner. The model never supplies this dependency.
export function createCommandExecutor({ sandboxRunner = runAgentSandboxCommand } = {}) {
  if (typeof sandboxRunner !== "function") {
    throw new Error("sandboxRunner must be a function");
  }

  return async function executeCommand(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("command input must be an object");
    }
    for (const key of Object.keys(input)) {
      if (!new Set(["workspaceRoot", "command", "mode"]).has(key)) {
        throw new Error(`command received unexpected argument: ${key}`);
      }
    }
    const { workspaceRoot, command, mode } = input;
    const root = await resolveWorkspaceRoot(workspaceRoot);
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new Error("command must be a non-empty string");
    }
    if (mode !== undefined && !SANDBOX_MODES.includes(mode)) {
      throw new Error(`unknown sandbox mode: ${mode}`);
    }
    // This is the only process-execution boundary available to the agent. The
    // shared runner evaluates policy and starts the locked-down container; no
    // local shell or fallback execution path exists in this module.
    const result = await sandboxRunner({
      command: command.trim(),
      mode,
      cwd: root,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    };
  };
}

export const executeCommand = createCommandExecutor();

function entryType(entry) {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  return "other";
}

async function listDirectory(directory, recursive, base = directory, root = base) {
  const dirents = await readdir(directory, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  const entries = [];
  for (const entry of dirents) {
    const entryPath = resolve(directory, entry.name);
    const name = outputPath(base, entryPath);
    if (shouldHideFromAgentTraversal(outputPath(root, entryPath))) continue;
    entries.push({ name, type: entryType(entry) });

    // Do not follow directory symlinks during recursive listing. A direct
    // requested symlink is checked by resolveWorkspacePath; nested links stay
    // visible as "other" but are never traversed.
    if (recursive && entry.isDirectory()) {
      entries.push(...(await listDirectory(entryPath, true, base, root)));
    }
  }
  return entries;
}

// List a directory inside workspaceRoot. Recursive results use paths relative
// to the requested directory. Symlinks are not followed while walking.
export async function executeList({ workspaceRoot, path, recursive = false }) {
  if (typeof recursive !== "boolean") {
    throw new Error("recursive must be a boolean");
  }

  const resolved = await resolveWorkspacePath(workspaceRoot, path);
  assertAgentReadablePath(resolved.path, outputPath(resolved.root, resolved.target));
  if (!(await stat(resolved.target)).isDirectory()) {
    throw new Error("list requires a directory path");
  }

  return {
    path: resolved.path,
    entries: await listDirectory(resolved.target, recursive, resolved.target, resolved.root),
  };
}

function globToRegExp(glob) {
  let source = "^";

  for (let i = 0; i < glob.length; i++) {
    const character = glob[i];
    if (character === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }

  return new RegExp(`${source}$`);
}

async function collectFiles(target, root) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return shouldHideFromAgentTraversal(outputPath(root, target)) ? [] : [target];
  if (!targetStat.isDirectory()) return [];

  const files = [];
  const dirents = await readdir(target, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of dirents) {
    const entryPath = resolve(target, entry.name);
    if (shouldHideFromAgentTraversal(outputPath(root, entryPath))) continue;
    if (entry.isFile()) {
      files.push(entryPath);
    } else if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, root)));
    }
    // Symlinks and non-regular files are intentionally skipped. This avoids
    // walking links that could escape the workspace during a recursive search.
  }
  return files;
}

// Search UTF-8 text files for a plain substring. `glob`, when supplied, uses
// a small *, ?, ** matcher against workspace-relative paths. Files containing
// a NUL byte are treated as binary and skipped. No shell command is used.
export async function executeGrep({ workspaceRoot, pattern, path = ".", glob }) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("pattern must be a non-empty string");
  }
  if (glob !== undefined && typeof glob !== "string") {
    throw new Error("glob must be a string");
  }

  const resolved = await resolveWorkspacePath(workspaceRoot, path);
  assertAgentReadablePath(resolved.path, outputPath(resolved.root, resolved.target));
  const matcher = glob === undefined ? null : globToRegExp(glob);
  const matches = [];

  for (const file of await collectFiles(resolved.target, resolved.root)) {
    const relativePath = outputPath(resolved.root, file);
    if (matcher && !matcher.test(relativePath)) continue;

    const content = await readFile(file, "utf8");
    if (content.includes("\0")) continue;

    for (const [index, text] of linesFrom(content).entries()) {
      if (text.includes(pattern)) {
        matches.push({ path: relativePath, line: index + 1, text });
      }
    }
  }

  return { matches };
}
