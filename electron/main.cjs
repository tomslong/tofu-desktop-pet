const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  screen,
  clipboard,
  globalShortcut,
  powerMonitor,
  session,
} = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("./store.cjs");
const { createHookServer } = require("./hook-server.cjs");

app.setName("Tofu");
if (process.platform === "win32") app.setAppUserModelId("dev.tofu.deskpet");

const ROOT = path.join(__dirname, "..");
const PET_WIDTH = 340;
const PET_HEIGHT = 450;
const SETTINGS_WIDTH = 500;
const SETTINGS_HEIGHT = 720;
const PALETTES = new Set(["miso", "matcha", "taro", "yuzu"]);
const VALID_STATES = new Set([
  "idle",
  "working",
  "review",
  "waiting",
  "failed",
  "waving",
  "jumping",
  "sleeping",
  "happy",
  "eating",
  "dragged",
]);
const CARE_COOLDOWN = { pet: 700, feed: 1100, play: 1800, nap: 30000 };
const PET_SCALE_MIN = 0.5;
const PET_SCALE_MAX = 1.2;
const BUBBLE_GAP = 20;
const JOY_MS = 30 * 60 * 1000;
const ENERGY_MS = 20 * 60 * 1000;
const TREAT_MS = 2 * 60 * 60 * 1000;

const DEV = process.argv.includes("--dev") || process.argv.includes("--devtools");
const DEVTOOLS = process.argv.includes("--devtools");
const gotLock = app.requestSingleInstanceLock();

let store;
let petWin = null;
let settingsWin = null;
let tray = null;
let appIcon = null;
let hookServer = null;
let hookQueue = Promise.resolve();
let hookStatus = { ok: false, port: 0, error: "" };
let hookCommand = "node bin/tofu-hook.mjs pre --tool edit";
let hookPortFile = "";
let agentIdleTimer = null;
let isQuitting = false;
let dragState = null;
let boundsTimer = null;
let hitTimer = null;
let lastIgnore = null;
let bubbleVisible = false;
let demoTimers = [];
let careAt = { pet: 0, feed: 0, play: 0, nap: 0 };
let agent = { active: false, state: "idle", source: "", at: 0 };
let runtimeAgentSnapshot = null;

const LINES = {
  start: ["开工！先伸个懒腰。", "来活了，我坐好。", "收到，爪子已就位。"],
  done: ["搞定。奖励一块小饼干？", "收工，爪子都热了。", "绿了绿了！", "这波可以。", "编译通过，猫猫满意。"],
  fail: ["啊哦，红了。", "报错了，但我还爱你。", "不是你的错。大概是。", "红色很显眼，但不是我的颜色。"],
  waiting: ["需要你点一下。", "我在等你的决定。", "轮到你啦，人类。", "这里，看这里。"],
  sessionEnd: ["下班。我也下班。", "今天到这里，明天继续。", "收工。我去晒太阳了。"],
  tools: {
    read: ["翻文件，找线索。", "读一下，别急。", "这页有点长。"],
    grep: ["在代码里嗅来嗅去…", "搜一下，马上。", "关键词藏哪儿了？"],
    glob: ["看看都有什么文件。", "目录侦察中。"],
    write: ["落笔，轻一点。", "写进去。希望别覆盖。", "新文件，新气息。"],
    edit: ["挪一点点像素…", "改这里，还是那里？", "手术很成功。"],
    bash: ["跑命令中，退后。", "终端时间。", "让子弹飞一会儿。"],
    test: ["测试精灵正在加班。", "等绿灯。", "跑测试，别眨眼。"],
    web: ["上网查一下，马上回来。", "外面的世界很大。"],
    task: ["拆任务中…", "一步一步来。"],
    agent: ["派了一只小猫去干活。", "子任务，启动。"],
    default: ["处理中，爪子很忙。", "让我看看。", "正在努力。"],
  },
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function toolLine(tool = "") {
  const key = String(tool).toLowerCase();
  const match = Object.keys(LINES.tools).find((name) => key === name || key.includes(name));
  return pick(LINES.tools[match] || LINES.tools.default);
}

function stateForTool(tool = "") {
  const key = String(tool).toLowerCase();
  if (["read", "grep", "glob", "review"].some((name) => key.includes(name))) return "review";
  return "working";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function cleanText(value, max = 160) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" ")}`;
  console.log(line);
  try {
    if (store) fs.appendFileSync(path.join(app.getPath("userData"), "main.log"), `${line}\n`, "utf8");
  } catch {
    // Logging should never be able to break the app.
  }
}

function careSnapshot() {
  const c = store.get().care;
  return {
    joy: Math.round(c.joy),
    energy: Math.round(c.energy),
    treats: Math.round(c.treats),
    headpats: Math.round(c.headpats || 0),
  };
}

function getRuntime() {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    hookOk: Boolean(hookStatus.ok),
    hookPort: hookStatus.port,
    hookError: hookStatus.error || "",
    hookCommand,
    isPackaged: app.isPackaged,
    firstRun: Boolean(store.get().firstRun),
  };
}

function snapshotState() {
  const data = store.get();
  return {
    profile: { ...data.profile },
    prefs: { ...data.prefs },
    care: careSnapshot(),
    window: { ...data.window },
    runtime: getRuntime(),
    firstRun: Boolean(data.firstRun),
  };
}

function broadcastState() {
  const payload = snapshotState();
  for (const win of [petWin, settingsWin]) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send("tofu:state", payload);
    } catch {
      // The window may be in the middle of loading.
    }
  }
  updateTray();
  saveState();
}

function broadcastAgent(event) {
  const payload = { ...event };
  if (event.state) {
    runtimeAgentSnapshot = {
      active: Boolean(event.active),
      state: event.state,
      source: event.source || "agent",
    };
  }
  for (const win of [petWin, settingsWin]) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send("tofu:agent", payload);
    } catch {
      // ignore
    }
  }
}

function sendCommand(command) {
  if (!petWin || petWin.isDestroyed()) return;
  try {
    petWin.webContents.send("tofu:command", command);
  } catch {
    // ignore
  }
}

function saveState() {
  store?.save();
}

/* Care ------------------------------------------------------------------ */
function decayCare(force = false) {
  const now = Date.now();
  const care = store.get().care;
  let changed = false;

  if (care.joy > 18) {
    const steps = Math.floor((now - care.joyAt) / JOY_MS);
    if (steps > 0) {
      care.joy = Math.max(18, care.joy - steps);
      care.joyAt += steps * JOY_MS;
      changed = true;
    }
  } else {
    care.joyAt = now;
  }

  if (care.energy > 12) {
    const steps = Math.floor((now - care.energyAt) / ENERGY_MS);
    if (steps > 0) {
      care.energy = Math.max(12, care.energy - steps);
      care.energyAt += steps * ENERGY_MS;
      changed = true;
    }
  } else {
    care.energyAt = now;
  }

  if (care.treats < 5) {
    const steps = Math.floor((now - care.treatAt) / TREAT_MS);
    if (steps > 0) {
      care.treats = Math.min(5, care.treats + steps);
      care.treatAt = care.treats >= 5 ? now : care.treatAt + steps * TREAT_MS;
      changed = true;
    }
  } else {
    care.treatAt = now;
  }

  if (changed || force) store.save();
  return changed;
}

function doCare(action) {
  const now = Date.now();
  const care = store.get().care;
  const cooldown = CARE_COOLDOWN[action] || 0;
  if (now - (careAt[action] || 0) < cooldown) {
    return { ok: false, reason: "cooldown", care: careSnapshot() };
  }
  careAt[action] = now;

  if (action === "pet") {
    care.joy = clamp(care.joy + 4, 0, 100);
    care.energy = clamp(care.energy + 1, 0, 100);
    care.headpats = (care.headpats || 0) + 1;
    care.joyAt = now;
  } else if (action === "feed") {
    if (care.treats <= 0) {
      careAt[action] = 0;
      return { ok: false, reason: "no-treats", care: careSnapshot() };
    }
    if (care.treats >= 5) care.treatAt = now;
    care.treats -= 1;
    care.energy = clamp(care.energy + 7, 0, 100);
    care.joy = clamp(care.joy + 3, 0, 100);
    care.energyAt = now;
    care.joyAt = now;
  } else if (action === "play") {
    care.joy = clamp(care.joy + 6, 0, 100);
    care.energy = clamp(care.energy - 4, 0, 100);
    care.joyAt = now;
    care.energyAt = now;
  } else if (action === "nap") {
    care.energy = clamp(care.energy + 18, 0, 100);
    care.joy = clamp(care.joy + 1, 0, 100);
    care.energyAt = now;
    care.joyAt = now;
  } else {
    return { ok: false, reason: "unknown", care: careSnapshot() };
  }

  broadcastState();
  return { ok: true, care: careSnapshot() };
}

function resetCare() {
  const now = Date.now();
  store.get().care = {
    joy: 82,
    energy: 74,
    treats: 3,
    headpats: 0,
    joyAt: now,
    energyAt: now,
    treatAt: now,
  };
  careAt = { pet: 0, feed: 0, play: 0, nap: 0 };
  store.saveNow();
  broadcastState();
}

/* Profile and preferences ------------------------------------------------ */
function updateProfile(patch = {}) {
  const profile = store.get().profile;
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    const name = cleanText(patch.name, 28).slice(0, 14);
    if (name) profile.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "palette") && PALETTES.has(patch.palette)) {
    profile.palette = patch.palette;
  }
  store.save();
  broadcastState();
  return { ...profile };
}

function applyPref(key, value) {
  const prefs = store.get().prefs;
  if (key === "alwaysOnTop" && petWin && !petWin.isDestroyed()) {
    petWin.setAlwaysOnTop(Boolean(value), "screen-saver");
  }
  if (key === "ghost" && petWin && !petWin.isDestroyed()) {
    lastIgnore = null;
    updateMouseIgnore(true);
  }
  if (key === "launchAtLogin") {
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: Boolean(value), openAsHidden: false });
      } catch (error) {
        console.error("[tofu] login item:", error.message);
      }
    }
  }
  if (key === "agentHooks") {
    queueHookRestart();
  }
}

function updatePrefs(patch = {}) {
  const prefs = store.get().prefs;
  const changed = [];

  if (Object.prototype.hasOwnProperty.call(patch, "size")) {
    prefs.size = clamp(patch.size, PET_SCALE_MIN, PET_SCALE_MAX);
    changed.push("size");
  }
  for (const key of ["alwaysOnTop", "ghost", "sound", "reducedMotion", "launchAtLogin", "agentHooks"]) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && typeof patch[key] === "boolean") {
      prefs[key] = patch[key];
      changed.push(key);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "port")) {
    const port = Math.round(clamp(patch.port, 1024, 65535));
    if (port !== prefs.port) {
      prefs.port = port;
      changed.push("port");
    }
  }

  for (const key of changed) applyPref(key, prefs[key]);
  store.save();
  if (changed.includes("port")) queueHookRestart();
  broadcastState();
  return { ...prefs };
}

/* Hook server ------------------------------------------------------------ */
function quoteArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function prepareHookCli() {
  const source = path.join(ROOT, "bin", "tofu-hook.mjs");
  let tofuDir = path.join(os.homedir(), ".tofu");
  try {
    fs.mkdirSync(tofuDir, { recursive: true });
    fs.accessSync(tofuDir, fs.constants.W_OK);
    const probe = path.join(tofuDir, ".tofu-write-test");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch (error) {
    log(`[tofu] home hook dir unavailable (${error.message}); falling back to userData`);
    tofuDir = path.join(app.getPath("userData"), "hooks");
    fs.mkdirSync(tofuDir, { recursive: true });
  }

  let cli = source;
  if (app.isPackaged) {
    const target = path.join(tofuDir, "tofu-hook.mjs");
    try {
      fs.writeFileSync(target, fs.readFileSync(source));
      cli = target;
    } catch (error) {
      // Some restricted Windows profiles allow mkdir/access but deny writes.
      log(`[tofu] could not stage hook CLI (${error.message}); using userData`);
      tofuDir = path.join(app.getPath("userData"), "hooks");
      fs.mkdirSync(tofuDir, { recursive: true });
      const fallback = path.join(tofuDir, "tofu-hook.mjs");
      fs.writeFileSync(fallback, fs.readFileSync(source));
      cli = fallback;
    }
  }

  hookPortFile = path.join(tofuDir, "hook.json");
  log(`[tofu] hook cli dir: ${tofuDir}`);
  hookCommand = `node ${quoteArg(cli)} pre --tool edit`;
}

function writeHookDescriptor(port) {
  try {
    if (!hookPortFile) return;
    if (!port) {
      fs.rmSync(hookPortFile, { force: true });
      return;
    }
    fs.writeFileSync(
      hookPortFile,
      JSON.stringify({ app: "tofu", port, url: `http://127.0.0.1:${port}`, pid: process.pid }, null, 2),
      "utf8",
    );
  } catch (error) {
    log(`[tofu] could not write hook descriptor: ${error.message}`);
  }
}

function queueHookRestart() {
  hookQueue = hookQueue
    .then(() => startHookServer())
    .catch((error) => {
      console.error("[tofu] hook restart failed:", error);
    });
  return hookQueue;
}

async function startHookServer() {
  if (!store.get().prefs.agentHooks) {
    if (hookServer) await hookServer.stop();
    hookStatus = { ok: false, port: 0, error: "hooks disabled" };
    writeHookDescriptor(0);
    broadcastState();
    return;
  }

  if (!hookServer) {
    hookServer = createHookServer({
      version: app.getVersion(),
      onEvent: handleHookEvent,
      getState: () => agent.state,
      onStatus: (status) => {
        hookStatus = {
          ok: Boolean(status.ok),
          port: Number(status.port) || 0,
          error: status.error || "",
        };
        writeHookDescriptor(hookStatus.ok ? hookStatus.port : 0);
        broadcastState();
      },
    });
  }

  const result = await hookServer.start(store.get().prefs.port);
  hookStatus = {
    ok: Boolean(result.ok),
    port: Number(result.port) || 0,
    error: result.error || "",
  };
  writeHookDescriptor(hookStatus.ok ? hookStatus.port : 0);
  if (hookStatus.ok) {
    log(`[tofu] hook server listening on 127.0.0.1:${hookStatus.port}`);
  } else {
    log(`[tofu] hook server failed: ${hookStatus.error || "unknown error"}`);
  }
  broadcastState();
}

/* Agent events ----------------------------------------------------------- */
function buildAgentEvent(payload = {}) {
  const type = String(payload.type || "").toLowerCase();
  const source = cleanText(payload.source, 24) || "agent";
  const customText = cleanText(payload.text, 190);
  const customDuration = clamp(payload.duration, 0, 15000);
  const forceBubble = Boolean(customText) || Boolean(payload.priority);
  let event = null;

  if (type === "pre") {
    const state = stateForTool(payload.tool);
    event = {
      state,
      baseState: state,
      active: true,
      duration: customDuration,
      bubble: customText || toolLine(payload.tool),
      phase: "pre",
      source,
      tool: cleanText(payload.tool, 48),
      priority: forceBubble,
    };
  } else if (type === "post") {
    const state = "review";
    event = {
      state,
      baseState: state,
      active: true,
      duration: customDuration,
      bubble: customText,
      phase: "post",
      source,
      tool: cleanText(payload.tool, 48),
      priority: forceBubble,
    };
  } else if (type === "stop") {
    event = {
      state: "waving",
      baseState: "waving",
      active: false,
      duration: customDuration || 2800,
      bubble: customText || pick(LINES.done),
      phase: "stop",
      source,
      priority: true,
    };
  } else if (type === "session-end") {
    event = {
      state: "waving",
      baseState: "waving",
      active: false,
      duration: customDuration || 2500,
      bubble: customText || pick(LINES.sessionEnd),
      phase: "stop",
      source,
      priority: true,
    };
  } else if (["failure", "tool-failure", "error"].includes(type)) {
    event = {
      state: "failed",
      baseState: "failed",
      active: false,
      duration: customDuration || 5200,
      bubble: customText || pick(LINES.fail),
      phase: "failure",
      source,
      tool: cleanText(payload.tool, 48),
      priority: true,
    };
  } else if (["session-start", "user-prompt"].includes(type)) {
    event = {
      state: "jumping",
      baseState: "working",
      active: true,
      duration: customDuration || 1500,
      bubble: customText || pick(LINES.start),
      phase: "start",
      source,
      priority: true,
    };
  } else if (["waiting", "notification", "permission"].includes(type)) {
    event = {
      state: "waiting",
      baseState: "waiting",
      active: true,
      duration: customDuration,
      bubble: customText || pick(LINES.waiting),
      phase: "waiting",
      source,
      priority: true,
    };
  } else if (type === "bubble") {
    if (!customText) throw new Error("bubble needs text");
    return { bubbleOnly: true, text: customText, source };
  } else if (type === "state") {
    const state = String(payload.state || "").toLowerCase();
    if (!VALID_STATES.has(state)) throw new Error(`unknown state: ${state}`);
    event = {
      state,
      baseState: state,
      active: !["idle", "sleeping"].includes(state),
      duration: customDuration,
      bubble: customText,
      phase: "state",
      source,
      priority: Boolean(customText),
    };
  } else if (["working", "running", "review", "waiting", "idle"].includes(type)) {
    const state = type === "running" ? "working" : type;
    event = {
      state,
      baseState: state,
      active: state !== "idle",
      duration: customDuration,
      bubble: customText,
      phase: "state",
      source,
      priority: Boolean(customText),
    };
  } else {
    throw new Error(`unknown event type: ${type}`);
  }

  return event;
}

function dispatchAgentEvent(event) {
  if (!event) return;
  if (event.bubbleOnly) {
    broadcastAgent({ bubble: event.text, source: event.source });
    return;
  }
  clearTimeout(agentIdleTimer);
  agent = {
    active: Boolean(event.active),
    state: event.baseState || event.state,
    source: event.source,
    at: Date.now(),
  };
  if (!event.active) {
    agentIdleTimer = setTimeout(() => {
      agent = { ...agent, active: false, state: "idle", at: Date.now() };
      runtimeAgentSnapshot = { active: false, state: "idle", source: agent.source };
    }, (event.duration || 0) + 300);
  }
  if (event.phase === "stop") {
    const care = store.get().care;
    care.joy = clamp(care.joy + 1, 0, 100);
    care.joyAt = Date.now();
    store.save();
    broadcastState();
  }
  broadcastAgent(event);
}

function handleHookEvent(payload) {
  const event = buildAgentEvent(payload);
  dispatchAgentEvent(event);
  return {
    state: event.bubbleOnly ? agent.state : event.state,
    active: event.bubbleOnly ? agent.active : event.active,
    source: event.source,
  };
}

function runDemo(kind) {
  for (const timer of demoTimers) clearTimeout(timer);
  demoTimers = [];
  showPet();
  const demoTimersAdd = (fn, delay) => {
    demoTimers.push(setTimeout(fn, delay));
  };
  const send = (payload) => dispatchAgentEvent(buildAgentEvent(payload));

  if (kind === "done") {
    send({ type: "stop", source: "demo" });
    return;
  }
  if (kind === "fail") {
    send({ type: "failure", source: "demo" });
    return;
  }
  if (kind === "waiting") {
    send({ type: "waiting", source: "demo" });
    return;
  }

  send({ type: "session-start", source: "demo" });
  demoTimersAdd(() => send({ type: "pre", tool: "read", source: "demo", priority: true }), 1600);
  demoTimersAdd(() => send({ type: "pre", tool: "edit", source: "demo", priority: true }), 3300);
  demoTimersAdd(() => send({ type: "post", tool: "edit", source: "demo" }), 5000);
  demoTimersAdd(() => send({ type: "stop", source: "demo" }), 6400);
}

/* Windows ---------------------------------------------------------------- */
/* Input hit-testing ------------------------------------------------------ */
// OS-level click-through is driven from the main process. Relying only on
// forwarded mousemove events is fragile on Windows, so a tiny cursor poll keeps
// the cat, dock and visible bubble interactive while everything else passes
// through to the desktop.
function isCursorOverPet() {
  if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return false;
  const point = screen.getCursorScreenPoint();
  const bounds = petWin.getBounds();
  const x = point.x - bounds.x;
  const y = point.y - bounds.y;
  const size = clamp(store.get().prefs.size, PET_SCALE_MIN, PET_SCALE_MAX);
  // Mirrors the CSS stage geometry: the canvas is bottom-aligned at y=404,
  // 256px tall, and scaled from an origin 91% down its own height.
  const half = 128 * size + 12;
  const canvasTop = 148 + 232.96 * (1 - size);
  const stage = x >= 170 - half && x <= 170 + half && y >= canvasTop - 12 && y <= 416;
  const dock = x >= 16 && x <= 324 && y >= 404 && y <= 446;
  const bubbleBottom = canvasTop - BUBBLE_GAP;
  const bubbleTop = Math.max(0, bubbleBottom - 170);
  const bubble =
    bubbleVisible && x >= 6 && x <= 334 && y >= bubbleTop && y <= bubbleBottom + 40;
  return stage || dock || bubble;
}

function updateMouseIgnore(force = false) {
  if (!petWin || petWin.isDestroyed()) return;
  if (dragState) {
    if (lastIgnore !== false || force) {
      lastIgnore = false;
      petWin.setIgnoreMouseEvents(false);
    }
    return;
  }
  const ignore = Boolean(store.get().prefs.ghost) || !isCursorOverPet();
  if (!force && ignore === lastIgnore) return;
  lastIgnore = ignore;
  petWin.setIgnoreMouseEvents(ignore, { forward: true });
}

function startHitPolling() {
  clearInterval(hitTimer);
  hitTimer = setInterval(() => updateMouseIgnore(), 70);
}

function defaultPetPosition(display = screen.getPrimaryDisplay()) {
  const area = display.workArea;
  return {
    x: Math.round(area.x + area.width - PET_WIDTH - 26),
    y: Math.round(area.y + area.height - PET_HEIGHT - 8),
  };
}

function isPositionSane(position) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX = Math.min(area.x + area.width, position.x + PET_WIDTH) - Math.max(area.x, position.x);
    const overlapY = Math.min(area.y + area.height, position.y + PET_HEIGHT) - Math.max(area.y, position.y);
    return overlapX > 120 && overlapY > 120;
  });
}

function clampToDisplay(x, y, display) {
  const area = display.workArea;
  const maxX = Math.max(area.x, area.x + area.width - PET_WIDTH);
  const maxY = Math.max(area.y, area.y + area.height - PET_HEIGHT);
  return {
    x: Math.round(clamp(x, area.x, maxX)),
    y: Math.round(clamp(y, area.y, maxY)),
  };
}

function placePetInitial() {
  const saved = store.get().window;
  if (saved.x !== null && saved.y !== null && isPositionSane(saved)) {
    const display = screen.getDisplayNearestPoint({ x: saved.x + PET_WIDTH / 2, y: saved.y + PET_HEIGHT / 2 });
    return clampToDisplay(saved.x, saved.y, display);
  }
  return defaultPetPosition();
}

function scheduleSaveBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!petWin || petWin.isDestroyed()) return;
    const [x, y] = petWin.getPosition();
    store.get().window = { x, y };
    store.save();
  }, 320);
}

function createPetWindow() {
  const { x, y } = placePetInitial();
  petWin = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    acceptFirstMouse: true,
    show: false,
    roundedCorners: false,
    alwaysOnTop: true,
    title: "Tofu",
    icon: appIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spelling: false,
      backgroundThrottling: false,
    },
  });

  petWin.setMenuBarVisibility(false);
  petWin.setAlwaysOnTop(Boolean(store.get().prefs.alwaysOnTop), "screen-saver");
  try {
    petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // Windows ignores this.
  }

  petWin.loadFile(path.join(ROOT, "src", "pet.html"));
  petWin.once("ready-to-show", () => {
    if (!petWin || petWin.isDestroyed()) return;
    petWin.showInactive();
    lastIgnore = null;
    updateMouseIgnore(true);
    startHitPolling();
    if (DEVTOOLS) petWin.webContents.openDevTools({ mode: "detach" });
  });
  petWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWin.webContents.on("will-navigate", (event) => event.preventDefault());
  if (DEV) {
    petWin.webContents.on("console-message", (event, level, message) => {
      if (typeof message === "string" && message.startsWith("[tofu]")) log(`renderer: ${message}`);
    });
  }
  petWin.on("move", scheduleSaveBounds);
  petWin.on("hide", updateTray);
  petWin.on("show", updateTray);
  petWin.on("closed", () => {
    petWin = null;
    clearInterval(hitTimer);
    hitTimer = null;
    updateTray();
  });
}

function showPet() {
  if (!petWin || petWin.isDestroyed()) {
    createPetWindow();
    return;
  }
  if (petWin.isMinimized()) petWin.restore();
  petWin.showInactive();
  petWin.setAlwaysOnTop(Boolean(store.get().prefs.alwaysOnTop), "screen-saver");
  lastIgnore = null;
  updateMouseIgnore(true);
  startHitPolling();
  updateTray();
}

function hidePet() {
  if (petWin && !petWin.isDestroyed()) petWin.hide();
  updateTray();
}

function togglePet() {
  if (petWin && !petWin.isDestroyed() && petWin.isVisible()) hidePet();
  else showPet();
}

function resetPosition() {
  const display = screen.getPrimaryDisplay();
  const position = defaultPetPosition(display);
  if (!petWin || petWin.isDestroyed()) createPetWindow();
  petWin.setPosition(position.x, position.y);
  store.get().window = position;
  store.saveNow();
  showPet();
  updateTray();
  return position;
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin;

  const petBounds = petWin && !petWin.isDestroyed() ? petWin.getBounds() : null;
  const display = petBounds
    ? screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y })
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = SETTINGS_WIDTH;
  const height = Math.min(SETTINGS_HEIGHT, Math.max(560, area.height - 24));
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + Math.max(8, (area.height - height) / 2));

  settingsWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    roundedCorners: false,
    backgroundColor: "#f6ecd9",
    title: "Tofu — Settings",
    icon: appIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spelling: false,
      backgroundThrottling: false,
    },
  });

  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(ROOT, "src", "settings.html"));
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWin.webContents.on("will-navigate", (event) => event.preventDefault());
  settingsWin.webContents.on("did-finish-load", () => {
    if (runtimeAgentSnapshot) {
      settingsWin.webContents.send("tofu:agent", {
        ...runtimeAgentSnapshot,
        duration: 0,
        bubble: "",
      });
    }
  });
  settingsWin.once("ready-to-show", () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    settingsWin.show();
    settingsWin.focus();
    if (DEVTOOLS) settingsWin.webContents.openDevTools({ mode: "detach" });
  });
  settingsWin.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWin.hide();
      updateTray();
    }
  });
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
  return settingsWin;
}

function openSettings() {
  if (store.get().firstRun) {
    store.get().firstRun = false;
    store.save();
  }
  const win = createSettingsWindow();
  if (!win.isVisible()) {
    if (win.webContents.isLoading()) {
      win.once("ready-to-show", () => {
        if (!win.isDestroyed()) {
          win.show();
          win.focus();
        }
      });
    } else {
      win.show();
      win.focus();
    }
  } else {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  updateTray();
}

function closeSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
  updateTray();
}

function minimizeSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.minimize();
}

/* Tray ------------------------------------------------------------------- */
function loadNativeAsset(relative) {
  try {
    // Read through fs so the assets also work when the app is packed in an asar.
    return nativeImage.createFromBuffer(fs.readFileSync(path.join(ROOT, relative)));
  } catch {
    return nativeImage.createEmpty();
  }
}

function trayImage() {
  let image = loadNativeAsset(path.join("assets", "tray.png"));
  if (image.isEmpty()) {
    image = loadNativeAsset(path.join("assets", "icon.png"));
    if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  }
  return image;
}

function sendCareCommand(action) {
  showPet();
  setTimeout(() => sendCommand({ action }), 120);
}

function buildTrayMenu() {
  const data = store.get();
  const visible = Boolean(petWin && !petWin.isDestroyed() && petWin.isVisible());
  return Menu.buildFromTemplate([
    { label: `Tofu · ${data.profile.name}`, enabled: false },
    { type: "separator" },
    {
      label: visible ? "隐藏 Tofu" : "显示 Tofu",
      accelerator: "CommandOrControl+Alt+P",
      click: togglePet,
    },
    { label: "投喂一块小饼干", click: () => sendCareCommand("feed") },
    { label: "摸摸它", click: () => sendCareCommand("pet") },
    { label: "陪它玩一下", click: () => sendCareCommand("play") },
    {
      label: "打开设置…",
      accelerator: "CommandOrControl+Alt+,",
      click: openSettings,
    },
    { type: "separator" },
    {
      label: "幽灵模式（点击穿透）",
      type: "checkbox",
      checked: Boolean(data.prefs.ghost),
      click: (item) => updatePrefs({ ghost: item.checked }),
    },
    {
      label: "始终置顶",
      type: "checkbox",
      checked: Boolean(data.prefs.alwaysOnTop),
      click: (item) => updatePrefs({ alwaysOnTop: item.checked }),
    },
    {
      label: "音效",
      type: "checkbox",
      checked: Boolean(data.prefs.sound),
      click: (item) => updatePrefs({ sound: item.checked }),
    },
    { type: "separator" },
    { label: "召回桌面（复位位置）", click: resetPosition },
    {
      label: "试试助手联动",
      submenu: [
        { label: "演示一轮工作", click: () => runDemo("work") },
        { label: "完成", click: () => runDemo("done") },
        { label: "报错", click: () => runDemo("fail") },
        { label: "等待确认", click: () => runDemo("waiting") },
      ],
    },
    { type: "separator" },
    { label: "退出 Tofu", click: quitApp },
  ]);
}

function updateTray() {
  if (!tray) return;
  const data = store?.get();
  if (!data) return;
  const mood = Math.round(data.care.joy);
  tray.setToolTip(`Tofu · 桌面搭子 · 心情 ${mood}`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const image = trayImage();
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Tofu · 桌面搭子");
  tray.setContextMenu(buildTrayMenu());
  if (process.platform !== "darwin") {
    tray.on("click", togglePet);
  }
  tray.on("double-click", showPet);
}

/* Context menu ----------------------------------------------------------- */
function popupContextMenu() {
  if (!petWin || petWin.isDestroyed()) return;
  const data = store.get();
  const menu = Menu.buildFromTemplate([
    { label: `${data.profile.name} 的小菜单`, enabled: false },
    { type: "separator" },
    { label: "摸摸它", click: () => sendCommand({ action: "pet" }) },
    { label: "投喂小饼干", click: () => sendCommand({ action: "feed" }) },
    { label: "陪它玩一下", click: () => sendCommand({ action: "play" }) },
    { label: "让它午睡", click: () => sendCommand({ action: "nap" }) },
    { type: "separator" },
    { label: "设置…", click: openSettings },
    {
      label: "幽灵模式（点击穿透）",
      type: "checkbox",
      checked: Boolean(data.prefs.ghost),
      click: (item) => updatePrefs({ ghost: item.checked }),
    },
    {
      label: "始终置顶",
      type: "checkbox",
      checked: Boolean(data.prefs.alwaysOnTop),
      click: (item) => updatePrefs({ alwaysOnTop: item.checked }),
    },
    { type: "separator" },
    { label: "隐藏 Tofu", click: hidePet },
    { label: "退出", click: quitApp },
  ]);
  menu.popup({ window: petWin });
}

/* Drag ------------------------------------------------------------------- */
function stopDrag() {
  if (!dragState) return;
  clearInterval(dragState.interval);
  clearTimeout(dragState.timeout);
  const moved = dragState.moved;
  dragState = null;
  if (moved) {
    if (DEV) log(`[tofu] drag end: ${JSON.stringify(petWin?.getBounds())}`);
    scheduleSaveBounds();
  }
  lastIgnore = null;
  updateMouseIgnore(true);
}

function startDrag() {
  if (!petWin || petWin.isDestroyed()) return false;
  stopDrag();
  const point = screen.getCursorScreenPoint();
  const bounds = petWin.getBounds();
  if (DEV) log(`[tofu] drag start: cursor=${point.x},${point.y} bounds=${bounds.x},${bounds.y}`);
  dragState = {
    startX: point.x,
    startY: point.y,
    winX: bounds.x,
    winY: bounds.y,
    moved: false,
    interval: null,
    timeout: null,
  };
  petWin.setIgnoreMouseEvents(false);
  dragState.interval = setInterval(() => {
    if (!dragState || !petWin || petWin.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - dragState.startX;
    const dy = cursor.y - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < 4) return;
    dragState.moved = true;
    const display = screen.getDisplayNearestPoint(cursor);
    const position = clampToDisplay(dragState.winX + dx, dragState.winY + dy, display);
    petWin.setPosition(position.x, position.y, false);
  }, 12);
  dragState.timeout = setTimeout(() => {
    stopDrag();
  }, 8000);
  return true;
}

/* Shortcuts -------------------------------------------------------------- */
function registerShortcuts() {
  const shortcuts = [
    ["CommandOrControl+Alt+P", togglePet],
    ["CommandOrControl+Alt+,", openSettings],
  ];
  for (const [accelerator, handler] of shortcuts) {
    try {
      if (!globalShortcut.isRegistered(accelerator)) globalShortcut.register(accelerator, handler);
    } catch (error) {
      console.error("[tofu] shortcut:", accelerator, error.message);
    }
  }
}

/* IPC -------------------------------------------------------------------- */
function isTrustedSender(event) {
  const id = event.sender.id;
  return [petWin, settingsWin].some((win) => win && !win.isDestroyed() && win.webContents.id === id);
}

function setupIpc() {
  ipcMain.handle("app:bootstrap", (event) => {
    if (!isTrustedSender(event)) return null;
    return {
      ...snapshotState(),
      runtime: { ...getRuntime() },
    };
  });

  ipcMain.handle("profile:update", (event, patch) => {
    if (!isTrustedSender(event)) return null;
    return updateProfile(patch);
  });

  ipcMain.handle("prefs:update", (event, patch) => {
    if (!isTrustedSender(event)) return null;
    return updatePrefs(patch);
  });

  ipcMain.handle("care:do", (event, action) => {
    if (!isTrustedSender(event)) return null;
    if (!CARE_COOLDOWN[action]) return { ok: false, reason: "unknown", care: careSnapshot() };
    return doCare(action);
  });

  ipcMain.handle("app:open-settings", (event) => {
    if (!isTrustedSender(event)) return false;
    openSettings();
    return true;
  });

  ipcMain.handle("app:close-settings", (event) => {
    if (!isTrustedSender(event)) return false;
    closeSettings();
    return true;
  });

  ipcMain.handle("app:minimize-settings", (event) => {
    if (!isTrustedSender(event)) return false;
    minimizeSettings();
    return true;
  });

  ipcMain.handle("app:hide-pet", (event) => {
    if (!isTrustedSender(event)) return false;
    hidePet();
    return true;
  });

  ipcMain.handle("app:quit", (event) => {
    if (!isTrustedSender(event)) return false;
    quitApp();
    return true;
  });

  ipcMain.handle("app:reset-position", (event) => {
    if (!isTrustedSender(event)) return false;
    return resetPosition();
  });

  ipcMain.handle("app:reset-care", (event) => {
    if (!isTrustedSender(event)) return false;
    resetCare();
    return careSnapshot();
  });

  ipcMain.handle("app:show-context-menu", (event) => {
    if (!isTrustedSender(event)) return false;
    popupContextMenu();
    return true;
  });

  ipcMain.handle("app:copy-text", (event, text) => {
    if (!isTrustedSender(event)) return false;
    clipboard.writeText(String(text || "").slice(0, 2000));
    return true;
  });

  ipcMain.handle("app:drag-start", (event) => {
    if (!isTrustedSender(event) || event.sender.id !== petWin?.webContents.id) return false;
    return startDrag();
  });

  ipcMain.handle("app:drag-end", (event) => {
    if (!isTrustedSender(event)) return false;
    stopDrag();
    return true;
  });

  ipcMain.handle("app:set-ignore-mouse", (event, ignore) => {
    if (!isTrustedSender(event) || event.sender.id !== petWin?.webContents.id) return false;
    if (!petWin || petWin.isDestroyed()) return false;
    // Kept for renderer compatibility; the main-process hit poll is the
    // authority on pass-through.
    updateMouseIgnore(true);
    return true;
  });

  ipcMain.handle("app:bubble-visible", (event, visible) => {
    if (!isTrustedSender(event) || event.sender.id !== petWin?.webContents.id) return false;
    bubbleVisible = Boolean(visible);
    updateMouseIgnore(true);
    return true;
  });

  ipcMain.handle("app:demo", (event, kind) => {
    if (!isTrustedSender(event)) return false;
    runDemo(String(kind || "work"));
    return true;
  });

  ipcMain.handle("app:mark-onboarding", (event) => {
    if (!isTrustedSender(event)) return false;
    if (store.get().firstRun) {
      store.get().firstRun = false;
      store.save();
    }
    return true;
  });

  ipcMain.handle("app:show-pet", (event) => {
    if (!isTrustedSender(event)) return false;
    showPet();
    sendCommand({ action: "bubble", text: "我在这儿。" });
    return true;
  });
}

/* Lifecycle -------------------------------------------------------------- */
function quitApp() {
  isQuitting = true;
  for (const timer of demoTimers) clearTimeout(timer);
  demoTimers = [];
  if (dragState) stopDrag();
  clearTimeout(boundsTimer);
  try {
    store?.saveNow();
  } catch {
    // ignore
  }
  writeHookDescriptor(0);
  if (hookServer) {
    hookServer.stop().catch(() => {});
  }
  app.quit();
}

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!petWin) createPetWindow();
    showPet();
    sendCommand({ action: "bubble", text: "我在这儿。" });
    if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
      settingsWin.show();
      settingsWin.focus();
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin" && app.dock) {
      try {
        app.dock.hide();
      } catch {
        // ignore
      }
    }
    store = new Store(path.join(app.getPath("userData"), "state.json"));
    appIcon = loadNativeAsset(path.join("assets", "icon.png"));
    log(`[tofu] starting ${app.getVersion()} · userData=${app.getPath("userData")} · home=${os.homedir()}`);
    decayCare(true);
    prepareHookCli();
    setupIpc();
    createPetWindow();
    createTray();

    try {
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    } catch {
      // ignore
    }

    registerShortcuts();

    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: Boolean(store.get().prefs.launchAtLogin),
          openAsHidden: false,
        });
      } catch (error) {
        console.error("[tofu] login item:", error.message);
      }
    }

    await startHookServer();

    setInterval(() => {
      if (decayCare()) broadcastState();
    }, 60 * 1000);

    try {
      powerMonitor.on("resume", () => {
        if (decayCare()) broadcastState();
        sendCommand({ action: "bubble", text: "你回来了。我刚刚在打盹。" });
      });
    } catch {
      // powerMonitor is not available on every platform.
    }
  });

  app.on("activate", () => {
    if (!petWin) createPetWindow();
    showPet();
  });

  app.on("window-all-closed", () => {
    // A tray app keeps running with no windows.
  });

  app.on("before-quit", () => {
    isQuitting = true;
    clearTimeout(boundsTimer);
    clearTimeout(agentIdleTimer);
    clearInterval(hitTimer);
    try {
      store?.saveNow();
    } catch {
      // ignore
    }
    writeHookDescriptor(0);
    try {
      globalShortcut.unregisterAll();
    } catch {
      // ignore
    }
  });

  app.on("will-quit", () => {
    try {
      globalShortcut.unregisterAll();
    } catch {
      // ignore
    }
  });
}

// Keep a reference for debugging from DevTools without exposing it to renderers.
process.on("uncaughtException", (error) => {
  console.error("[tofu] uncaught exception:", error);
});
