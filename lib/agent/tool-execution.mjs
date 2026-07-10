// In-process execution for Alpha 1's read-only agent tools.
//
// These tools are deliberately separate from lib/agent/tools.mjs, which is
// the metadata-only registry. All functions require an explicit workspaceRoot
// and use Node built-ins only; none execute shell commands or mutate files.

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

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

function entryType(entry) {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  return "other";
}

async function listDirectory(directory, recursive, base = directory) {
  const dirents = await readdir(directory, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  const entries = [];
  for (const entry of dirents) {
    const entryPath = resolve(directory, entry.name);
    const name = outputPath(base, entryPath);
    entries.push({ name, type: entryType(entry) });

    // Do not follow directory symlinks during recursive listing. A direct
    // requested symlink is checked by resolveWorkspacePath; nested links stay
    // visible as "other" but are never traversed.
    if (recursive && entry.isDirectory()) {
      entries.push(...(await listDirectory(entryPath, true, base)));
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
  if (!(await stat(resolved.target)).isDirectory()) {
    throw new Error("list requires a directory path");
  }

  return {
    path: resolved.path,
    entries: await listDirectory(resolved.target, recursive),
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

async function collectFiles(target) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return [target];
  if (!targetStat.isDirectory()) return [];

  const files = [];
  const dirents = await readdir(target, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of dirents) {
    const entryPath = resolve(target, entry.name);
    if (entry.isFile()) {
      files.push(entryPath);
    } else if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
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
  const matcher = glob === undefined ? null : globToRegExp(glob);
  const matches = [];

  for (const file of await collectFiles(resolved.target)) {
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
