#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { getAppTemplates } from "../lib/templates.mjs";
import { checkApp } from "../lib/doctor.mjs";
import { runSandbox, sandboxStatus } from "../lib/sandbox.mjs";
import { runAgentCli } from "../lib/agent/cli.mjs";

const USAGE = `OAF — Opinionated App Factory (Alpha 0)

Usage:
  oaf init <app-name>   Create a new OAF app skeleton
  oaf doctor            Check the current directory is an OAF app
  oaf agent <task>      Run one configured agent task
  oaf --help            Show this help`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function validateName(name) {
  if (!name) fail(`Error: app name is required.\n\n${USAGE}`);
  if (name.includes("..")) fail(`Error: app name must not contain "..".`);
  if (name.includes("/") || name.includes("\\"))
    fail(`Error: app name must not contain path separators.`);
  if (isAbsolute(name)) fail(`Error: app name must not be an absolute path.`);
  return name;
}

function initApp(name) {
  validateName(name);
  const target = resolve(process.cwd(), name);

  if (existsSync(target)) {
    let entries = [];
    try {
      entries = readdirSync(target);
    } catch {
      // not a readable dir; treat as conflict
    }
    if (entries.length > 0) {
      fail(`Error: target path already exists and is not empty: ${target}`);
    }
  }

  mkdirSync(target, { recursive: true });
  const createdAt = new Date().toISOString();
  const tree = getAppTemplates(name, createdAt);

  for (const [rel, content] of Object.entries(tree)) {
    const full = join(target, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  console.log(`Created OAF app "${name}" at ${target}`);
  console.log(`Next: cd ${name} && oaf doctor`);
}

function doctor() {
  const results = checkApp(process.cwd());
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}`);
    if (!r.ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed. This is not a valid OAF app.`);
    process.exit(1);
  }
  console.log("\nDoctor: this is a valid OAF Alpha 0 app skeleton.");
}

async function runSandboxCli(args) {
  const [sub, ...rest] = args;
  if (sub === "status") {
    sandboxStatus();
    return;
  }
  if (sub === "run") {
    let network = false;
    let confirm = false;
    const cmdParts = [];
    for (const a of rest) {
      if (a === "--network") network = true;
      else if (a === "--confirm") confirm = true;
      else cmdParts.push(a);
    }
    const command = cmdParts.join(" ");
    if (!command) fail("Error: sandbox run requires a command.\n\n  oaf sandbox run <command>");
    const code = await runSandbox({ command, network, confirm });
    process.exit(typeof code === "number" ? code : 1);
  }
  console.error(`Unknown sandbox command: ${sub ?? "(none)"}\n`);
  console.log("Usage:\n  oaf sandbox run <command>\n  oaf sandbox status");
  process.exit(1);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "init":
    initApp(arg);
    break;
  case "doctor":
    doctor();
    break;
    case "sandbox":
      runSandboxCli(process.argv.slice(3));
      break;
    case "agent": {
      const taskParts = process.argv.slice(3);
      const result = taskParts.some((part) => part.startsWith("--"))
        ? { code: 2, message: "Error: agent command does not support options." }
        : await runAgentCli({ taskParts });
      if (result.message) console.error(result.message);
      process.exitCode = result.code;
      break;
    }
  case "--help":
  case "-h":
  case undefined:
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    console.log(USAGE);
    process.exit(1);
}
