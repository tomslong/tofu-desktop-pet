#!/usr/bin/env node
/*
 * tofu-hook — tell the Tofu desktop pet what your coding agent is doing.
 *
 * Examples:
 *   tofu-hook pre --tool edit
 *   tofu-hook stop
 *   tofu-hook bubble --text "build is green"
 *   tofu-hook --stdin < claude-hook-payload.json
 *
 * The hook never blocks the agent for long and always exits 0 when the desktop
 * app is not running.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (
    arg === "--stdin" ||
    arg === "--quiet" ||
    arg === "--verbose" ||
    arg === "--help" ||
    arg === "-h"
  ) {
    flags.set(arg, true);
  } else if (arg === "--tool" || arg === "--text" || arg === "--source" || arg === "--duration" || arg === "--url") {
    const value = args[i + 1];
    if (typeof value === "string" && !value.startsWith("--")) {
      flags.set(arg, value);
      i += 1;
    }
  } else if (arg.startsWith("--tool=")) {
    flags.set("--tool", arg.slice(7));
  } else if (arg.startsWith("--text=")) {
    flags.set("--text", arg.slice(7));
  } else if (arg.startsWith("--source=")) {
    flags.set("--source", arg.slice(9));
  } else if (arg.startsWith("--duration=")) {
    flags.set("--duration", arg.slice(11));
  } else if (arg === "--") {
    continue;
  } else if (!arg.startsWith("-")) {
    positional.push(arg);
  }
}

if (flags.has("--help") || flags.has("-h")) {
  console.log(`tofu-hook — send an event to the Tofu desktop pet

Usage:
  tofu-hook <event> [options]
  tofu-hook --stdin < agent-hook.json

Events:
  pre        a tool/task started          e.g. pre --tool edit
  post       a tool/task finished
  stop       the agent finished
  failure    the agent hit an error
  session-start / user-prompt / session-end
  waiting    the agent needs your input
  bubble     show a message               e.g. bubble --text "hi"
  working / review / idle

Options:
  --tool <name>       edit, read, bash, grep, test, web, task...
  --text <message>    custom bubble text (max 190 chars)
  --source <name>     agent name shown above the bubble
  --duration <ms>     how long the pet stays in this state
  --stdin             read a Claude Code / generic hook JSON payload
  --quiet             print nothing (implied by --stdin)
  --verbose           keep status output even with --stdin

Environment:
  TOFU_HOOK_URL   full hook URL, e.g. http://127.0.0.1:41234
  TOFU_HOOK_PORT  port only
`);
  process.exit(0);
}

function readPortDescriptor() {
  const candidates = [
    path.join(os.homedir(), ".tofu", "hook.json"),
    path.join(process.env.APPDATA || "", "Tofu", "hooks", "hook.json"),
    path.join(process.env.APPDATA || "", "tofu-desktop-pet", "hooks", "hook.json"),
  ];
  for (const file of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && Number.isInteger(data.port) && data.port >= 1024 && data.port <= 65535) {
        return data.port;
      }
    } catch {
      // Try the next location.
    }
  }
  return null;
}

function urlsToTry() {
  const urls = [];
  const explicit = flags.get("--url") || process.env.TOFU_HOOK_URL;
  if (explicit) urls.push(String(explicit));
  const envPort = Number(process.env.TOFU_HOOK_PORT);
  if (Number.isInteger(envPort) && envPort >= 1024 && envPort <= 65535) {
    urls.push(`http://127.0.0.1:${envPort}`);
  }
  const descriptorPort = readPortDescriptor();
  if (descriptorPort) urls.push(`http://127.0.0.1:${descriptorPort}`);
  for (const port of [41234, 41235, 41236, 41237]) {
    urls.push(`http://127.0.0.1:${port}`);
  }
  return [...new Set(urls)];
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(text);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
      if (text.length > 200000) finish();
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 1200);
  });
}

const CLAUDE_EVENTS = {
  SessionStart: "session-start",
  SessionEnd: "session-end",
  UserPromptSubmit: "user-prompt",
  PreToolUse: "pre",
  PostToolUse: "post",
  PostToolUseFailure: "failure",
  Stop: "stop",
  SubagentStop: "post",
  Notification: "waiting",
  PermissionRequest: "waiting",
  PreCompact: "waiting",
};

let stdinPayload = null;
if (flags.has("--stdin")) {
  const raw = await readStdin();
  if (raw) {
    try {
      stdinPayload = JSON.parse(raw);
    } catch {
      stdinPayload = null;
    }
  }
}

const hookName = stdinPayload?.hook_event_name || stdinPayload?.hookEventName;
const mappedType = CLAUDE_EVENTS[hookName] || null;
let type = String(positional[0] || mappedType || stdinPayload?.type || "").toLowerCase();
if (positional[0]) type = String(positional[0]).toLowerCase();

const tool =
  flags.get("--tool") ||
  stdinPayload?.tool_name ||
  stdinPayload?.toolName ||
  stdinPayload?.tool ||
  "";
const text = flags.get("--text") || stdinPayload?.text || stdinPayload?.message || "";
const duration = Number(flags.get("--duration") || stdinPayload?.duration || 0) || 0;
const source =
  flags.get("--source") ||
  stdinPayload?.source ||
  (hookName ? "claude" : "") ||
  "agent";

if (!type) {
  console.error("tofu-hook: missing event type. Try `tofu-hook --help`.");
  process.exit(0);
}

if (type === "bubble" && !text) {
  console.error("tofu-hook: bubble needs --text.");
  process.exit(0);
}

const payload = { type, tool, text, source, duration };
const muted = flags.has("--quiet") || (flags.has("--stdin") && !flags.has("--verbose"));
let lastError = "";

for (const base of urlsToTry()) {
  const endpoint = base.replace(/\/+$/, "");
  try {
    const response = await fetch(`${endpoint}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      if (!muted) {
        const result = await response.json().catch(() => ({}));
        console.log(`tofu: ${result.state || type}`);
      }
      process.exit(0);
    }
    if (response.status >= 400 && response.status < 500) {
      const result = await response.json().catch(() => ({}));
      lastError = result.error || `HTTP ${response.status}`;
      break;
    }
  } catch (error) {
    lastError = error?.message || "desktop not reachable";
  }
}

if (!muted && lastError) {
  console.error(`tofu: desktop not running (${lastError}) — event ignored.`);
}
process.exit(0);
