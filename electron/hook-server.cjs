const http = require("node:http");

const MAX_BODY = 16 * 1024;
const MAX_EVENTS_PER_WINDOW = 80;
const WINDOW_MS = 5000;

function clean(value, max = 160) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function createHookServer(options) {
  const { onEvent, getState, version, onStatus } = options;
  let server = null;
  let port = 0;
  let ok = false;
  let lastError = "";
  let windowStarted = Date.now();
  let windowCount = 0;

  function setStatus(next, error = "") {
    ok = next;
    lastError = error;
    try {
      onStatus?.({ ok, port, error: lastError });
    } catch {
      // A status listener must never take down the server.
    }
  }

  function rateLimited() {
    const now = Date.now();
    if (now - windowStarted > WINDOW_MS) {
      windowStarted = now;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount > MAX_EVENTS_PER_WINDOW;
  }

  async function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error("body too large"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (size === 0) return resolve({});
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return reject(Object.assign(new Error("body must be a JSON object"), { status: 400 }));
          }
          resolve(value);
        } catch {
          reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  async function handle(req, res) {
    // Hooks are for local agents. Browser pages get rejected so a random tab
    // cannot make the cat talk all afternoon.
    if (req.headers.origin) {
      return send(res, 403, { ok: false, error: "origin not allowed" });
    }
    if (rateLimited()) {
      return send(res, 429, { ok: false, error: "slow down" });
    }

    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        app: "tofu",
        version,
        port,
        state: typeof getState === "function" ? getState() : "idle",
        uptime: Math.round(process.uptime()),
      });
    }

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, {
        ok: true,
        name: "Tofu hook server",
        endpoints: ["POST /event", "POST /bubble", "POST /state", "GET /health"],
        example: { type: "pre", tool: "edit", source: "claude" },
      });
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, { Allow: "GET, POST, OPTIONS" });
      return res.end();
    }

    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "GET, POST, OPTIONS" });
      return res.end();
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return send(res, error.status || 400, { ok: false, error: error.message });
    }

    let type = clean(body.type || body.event || "", 32).toLowerCase();
    if (url.pathname === "/bubble") type = "bubble";
    if (url.pathname === "/state") type = "state";
    if (!type) return send(res, 400, { ok: false, error: "missing type" });

    const payload = {
      type,
      tool: clean(body.tool || body.tool_name || body.toolName, 48),
      text: clean(body.text || body.message, 190),
      source: clean(body.source || body.agent_source || body.agent, 24) || "agent",
      duration: Number(body.duration) || 0,
      state: clean(body.state, 24).toLowerCase(),
    };

    if (type === "bubble" && !payload.text) {
      return send(res, 400, { ok: false, error: "bubble needs text" });
    }

    try {
      const result = await onEvent(payload);
      return send(res, 200, { ok: true, ...result });
    } catch (error) {
      return send(res, 400, { ok: false, error: error.message || "event rejected" });
    }
  }

  function listenOn(target) {
    return new Promise((resolve, reject) => {
      const candidate = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
          if (!res.headersSent) send(res, 500, { ok: false, error: "internal error" });
          console.error("[tofu] hook handler error:", error);
        });
      });
      candidate.keepAliveTimeout = 4000;
      candidate.headersTimeout = 5000;
      const onError = (error) => {
        candidate.removeListener("listening", onListening);
        candidate.close(() => {});
        reject(error);
      };
      const onListening = () => {
        candidate.removeListener("error", onError);
        candidate.on("error", (error) => {
          console.error("[tofu] hook server error:", error.message);
          setStatus(false, error.message);
        });
        server = candidate;
        port = target;
        resolve();
      };
      candidate.once("error", onError);
      candidate.once("listening", onListening);
      candidate.listen(target, "127.0.0.1");
    });
  }

  async function start(preferred = 41234) {
    await stop();
    const base = Math.min(65535, Math.max(1024, Number(preferred) || 41234));
    let lastFailure = null;
    for (let offset = 0; offset < 8; offset += 1) {
      const target = base + offset;
      if (target > 65535) break;
      try {
        await listenOn(target);
        setStatus(true);
        return { ok: true, port };
      } catch (error) {
        lastFailure = error;
        if (error.code !== "EADDRINUSE") break;
      }
    }
    setStatus(false, lastFailure?.message || "could not listen");
    return { ok: false, port: 0, error: lastFailure?.message || "could not listen" };
  }

  async function stop() {
    const current = server;
    server = null;
    ok = false;
    if (!current) {
      port = 0;
      return;
    }
    await new Promise((resolve) => {
      try {
        current.close(() => resolve());
      } catch {
        resolve();
      }
      setTimeout(resolve, 600);
    });
    port = 0;
  }

  return {
    start,
    stop,
    get port() {
      return port;
    },
    get ok() {
      return ok;
    },
    get error() {
      return lastError;
    },
  };
}

module.exports = { createHookServer };
