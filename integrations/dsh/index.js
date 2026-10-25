/**
 * Tofu × DeepSeek Harness bridge.
 *
 * A tiny Host-only Cordis plugin. It forwards DSH agent lifecycle and tool
 * activity to Tofu's local hook server; it never sends prompts, file contents or
 * tool arguments off the machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:41234";
const REQUEST_TIMEOUT_MS = 800;
const ASK_TOOL = /ask|question|approval|permission|confirm/i;

function clean(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

function createNotifier(config) {
  const explicitUrl = clean(config.url, 200).replace(/\/+$/, "");
  const source = clean(config.source, 24) || "dsh";
  let cachedPort = 0;
  let cachedAt = 0;

  function resolveBase() {
    if (explicitUrl) return explicitUrl;
    if (process.env.TOFU_HOOK_URL) return String(process.env.TOFU_HOOK_URL).replace(/\/+$/, "");
    const now = Date.now();
    if (!cachedPort || now - cachedAt > 10_000) {
      cachedAt = now;
      try {
        const file = path.join(os.homedir(), ".tofu", "hook.json");
        const descriptor = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Number.isInteger(descriptor.port) && descriptor.port >= 1024 && descriptor.port <= 65535) {
          cachedPort = descriptor.port;
        }
      } catch {
        // Tofu may not be running, or it may be using its installer fallback.
      }
    }
    return cachedPort ? `http://127.0.0.1:${cachedPort}` : DEFAULT_URL;
  }

  return function notify(type, extra = {}) {
    const body = JSON.stringify({ type, source, ...extra });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    // Fire-and-forget: an agent event must never wait for the desktop pet.
    try {
      fetch(`${resolveBase()}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      })
        .catch(() => {})
        .finally(() => clearTimeout(timer));
    } catch {
      clearTimeout(timer);
    }
  };
}

export const name = "tofu-dsh-bridge";

export function apply(ctx, config = {}) {
  const notify = createNotifier(config || {});
  const disposers = [];

  const on = (event, handler) => {
    const dispose = ctx.on(event, handler);
    if (typeof dispose === "function") disposers.push(dispose);
  };

  // A new/resumed DSH agent wakes the cat up.
  on("agent/created", () => notify("session-start"));

  // Step 1 of a turn corresponds to a fresh user prompt.
  on("agent/pre-step", async (payload, next) => {
    if (payload?.step === 1) notify("user-prompt");
    return typeof next === "function" ? next() : undefined;
  });

  // Observe every tool call and its final outcome, but never alter either.
  on("tools/pre-execute", async (exec, next) => {
    const tool = clean(exec?.name, 48);
    if (tool) {
      if (ASK_TOOL.test(tool)) notify("waiting", { tool });
      else notify("pre", { tool });
    }
    return next();
  });

  on("tools/result", (exec, result) => {
    const tool = clean(exec?.name, 48);
    if (!tool) return;
    notify(result?.isError ? "failure" : "post", { tool });
  });

  on("agent/turn-stopping", () => notify("stop"));
  on("agent/error", () => notify("failure"));
  on("agent/disposed", () => notify("session-end"));

  // DSH's ask_user tool exposes this waterfall while it waits for the user.
  on("user-questions/request", (_request, next) => {
    notify("waiting");
    return typeof next === "function" ? next() : undefined;
  });

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Unloading one listener must not prevent the rest from unwinding.
      }
    }
  };
}
