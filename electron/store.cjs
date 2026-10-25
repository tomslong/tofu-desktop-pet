const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STATE = {
  version: 1,
  profile: {
    name: "Tofu",
    palette: "miso",
  },
  prefs: {
    size: 1,
    alwaysOnTop: true,
    ghost: false,
    sound: true,
    reducedMotion: false,
    launchAtLogin: false,
    agentHooks: true,
    port: 41234,
  },
  care: {
    joy: 82,
    energy: 74,
    treats: 3,
    headpats: 0,
    joyAt: 0,
    energyAt: 0,
    treatAt: 0,
  },
  window: {
    x: null,
    y: null,
  },
  firstRun: true,
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(base, incoming) {
  const out = clone(base);
  if (!isPlainObject(incoming)) return out;
  for (const key of Object.keys(out)) {
    if (!(key in incoming)) continue;
    if (isPlainObject(out[key])) {
      out[key] = merge(out[key], incoming[key]);
    } else if (
      typeof incoming[key] === typeof out[key] ||
      (incoming[key] === null && out[key] === null)
    ) {
      out[key] = incoming[key];
    }
  }
  return out;
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = clone(DEFAULT_STATE);
    this.saveTimer = null;
    this.load();
    this.repair();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      this.data = merge(DEFAULT_STATE, parsed);
    } catch {
      this.data = clone(DEFAULT_STATE);
    }
  }

  repair() {
    const now = Date.now();
    this.data.prefs.size = Math.min(1.2, Math.max(0.5, Number(this.data.prefs.size) || 1));
    if (!this.data.care.joyAt) this.data.care.joyAt = now;
    if (!this.data.care.energyAt) this.data.care.energyAt = now;
    if (!this.data.care.treatAt) this.data.care.treatAt = now;
    if (!Number.isFinite(this.data.window.x)) this.data.window.x = null;
    if (!Number.isFinite(this.data.window.y)) this.data.window.y = null;
  }

  get() {
    return this.data;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 260);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.error("[tofu] failed to save state:", error.message);
    }
  }
}

module.exports = { Store, DEFAULT_STATE, clone };
