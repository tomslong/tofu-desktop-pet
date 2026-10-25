import { PetEngine, PALETTES, STATE_COPY } from "./pet-engine.js";

const api = window.tofu;

// A browser-only fallback makes it possible to polish the UI outside Electron.
const fallbackState = {
  profile: { name: "Tofu", palette: "miso" },
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
  care: { joy: 82, energy: 74, treats: 3, headpats: 12 },
  runtime: {
    hookOk: true,
    hookPort: 41234,
    hookCommand: "node bin/tofu-hook.mjs pre --tool edit",
    appVersion: "1.0.0",
    platform: "win32",
    firstRun: false,
  },
};

const demoApi = {
  bootstrap: async () => structuredClone(fallbackState),
  updateProfile: async () => {},
  updatePrefs: async () => {},
  care: async (action) => {
    const care = { ...fallbackState.care };
    if (action === "pet") {
      care.joy += 4;
      care.headpats += 1;
    }
    if (action === "feed" && care.treats > 0) {
      care.treats -= 1;
      care.energy += 6;
      care.joy += 2;
    }
    if (action === "play") {
      care.joy += 5;
      care.energy = Math.max(0, care.energy - 4);
    }
    if (action === "nap") care.energy += 15;
    fallbackState.care = care;
    return { ok: true, care };
  },
  demo: async () => {},
  copyText: async (text) => navigator.clipboard?.writeText(text),
  openSettings: async () => {},
  closeSettings: async () => {},
  minimizeSettings: async () => {},
  resetPosition: async () => {},
  resetCare: async () => {},
  quit: async () => {},
  onState: () => {},
  onAgent: () => {},
};

const bridge = api || demoApi;

const els = {
  heroName: document.getElementById("hero-name-text"),
  heroStatus: document.getElementById("hero-status"),
  liveLed: document.getElementById("live-led"),
  preview: document.getElementById("preview"),
  nameInput: document.getElementById("name-input"),
  paletteRow: document.getElementById("palette-row"),
  sizeRange: document.getElementById("size-range"),
  sizeValue: document.getElementById("size-value"),
  versionBadge: document.getElementById("version-badge"),
  creditVersion: document.getElementById("credit-version"),
  portInput: document.getElementById("port-input"),
  hookLed: document.getElementById("hook-led"),
  hookLabel: document.getElementById("hook-label"),
  hookCommand: document.getElementById("hook-command"),
  copyCode: document.getElementById("copy-code"),
  barJoy: document.getElementById("bar-joy"),
  barEnergy: document.getElementById("bar-energy"),
  barTreats: document.getElementById("bar-treats"),
  joyValue: document.getElementById("joy-value"),
  energyValue: document.getElementById("energy-value"),
  treatsValue: document.getElementById("treats-value"),
  headpats: document.getElementById("headpats-value"),
  careNote: document.getElementById("care-note"),
  toast: document.getElementById("toast"),
};

const data = await bridge.bootstrap();
let profile = { ...data.profile };
let prefs = { ...data.prefs };
let care = { ...data.care };
let runtime = { ...data.runtime };

const preview = new PetEngine(els.preview, {
  palette: profile.palette,
  reducedMotion: prefs.reducedMotion,
});
preview.start();

let previewTimer = 0;
let toastTimer = 0;
let sizeTimer = 0;
let nameTimer = 0;
let resetArmed = false;
let agentState = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function truncateName(value) {
  return [...String(value)].slice(0, 14).join("").trim();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function updateHero() {
  els.heroName.textContent = profile.name || "Tofu";
  const active = agentState?.active;
  if (active) {
    const src = (agentState.source || "AGENT").toUpperCase();
    els.heroStatus.textContent = `${src} / ${(STATE_COPY[agentState.state] || agentState.state).toUpperCase()}`;
    els.liveLed.classList.add("busy");
  } else {
    els.heroStatus.textContent = `心情 ${Math.round(care.joy)} · 精力 ${Math.round(care.energy)}`;
    els.liveLed.classList.remove("busy");
  }
}

function updateStats() {
  const joy = clamp(care.joy, 0, 100);
  const energy = clamp(care.energy, 0, 100);
  const treats = clamp(care.treats, 0, 5);
  els.barJoy.style.width = `${joy}%`;
  els.barEnergy.style.width = `${energy}%`;
  els.barTreats.style.width = `${(treats / 5) * 100}%`;
  els.barJoy.parentElement.setAttribute("role", "progressbar");
  els.barJoy.parentElement.setAttribute("aria-valuenow", String(Math.round(joy)));
  els.barEnergy.parentElement.setAttribute("role", "progressbar");
  els.barEnergy.parentElement.setAttribute("aria-valuenow", String(Math.round(energy)));
  els.barTreats.parentElement.setAttribute("role", "progressbar");
  els.barTreats.parentElement.setAttribute("aria-valuenow", String(treats));
  els.joyValue.textContent = String(Math.round(joy));
  els.energyValue.textContent = String(Math.round(energy));
  els.treatsValue.textContent = `${Math.round(treats)} / 5`;
  els.headpats.textContent = String(care.headpats || 0);
  els.careNote.textContent =
    treats <= 0 ? "饼干盒空了，过一会儿再来看看。" : "饼干每两小时补货一块。";
  updateHero();
}

function updateHook() {
  const ok = Boolean(runtime.hookOk);
  const port = runtime.hookPort || prefs.port || 41234;
  els.hookLed.classList.toggle("off", !ok);
  els.hookLed.classList.toggle("error", !ok);
  els.hookLabel.textContent = ok ? "LISTENING" : "OFFLINE";
  els.hookLabel.title = runtime.hookError || "127.0.0.1";
  if (document.activeElement !== els.portInput) els.portInput.value = String(port);
  els.hookCommand.textContent = runtime.hookCommand || `node bin/tofu-hook.mjs pre --tool edit`;
  els.hookCommand.title = els.hookCommand.textContent;
}

function populate() {
  if (runtime.isPackaged === false) {
    const launchToggle = document.querySelector('[data-pref="launchAtLogin"]');
    const hint = launchToggle?.closest(".toggle-row")?.querySelector(".toggle-desc");
    if (hint) hint.textContent = "开发模式下只保存开关；打包后才会写入系统启动项。";
  }
  els.nameInput.value = profile.name || "Tofu";
  els.heroName.textContent = profile.name || "Tofu";
  els.preview.setAttribute("aria-label", `${profile.name || "Tofu"} preview`);
  document.querySelectorAll("[data-palette]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.palette === profile.palette));
  });
  const size = Math.round((Number(prefs.size) || 1) * 100);
  els.sizeRange.value = String(clamp(size, 50, 120));
  els.sizeValue.textContent = `${size}%`;
  document.querySelectorAll("[data-pref]").forEach((button) => {
    const key = button.dataset.pref;
    button.setAttribute("aria-checked", String(Boolean(prefs[key])));
  });
  const version = runtime.appVersion || "1.0.0";
  els.versionBadge.textContent = `v${version}`;
  els.creditVersion.textContent = `v${version}`;
  updateStats();
  updateHook();
  updateHero();
}

function applyState(next) {
  if (!next) return;
  if (next.profile) {
    profile = { ...profile, ...next.profile };
    if (document.activeElement !== els.nameInput) {
      els.nameInput.value = profile.name || "Tofu";
    }
    els.heroName.textContent = profile.name || "Tofu";
    preview.setPalette(profile.palette);
    document.querySelectorAll("[data-palette]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.palette === profile.palette));
    });
  }
  if (next.prefs) {
    prefs = { ...prefs, ...next.prefs };
    preview.setReducedMotion(Boolean(prefs.reducedMotion));
    document.querySelectorAll("[data-pref]").forEach((button) => {
      button.setAttribute("aria-checked", String(Boolean(prefs[button.dataset.pref])));
    });
    const size = Math.round((Number(prefs.size) || 1) * 100);
    els.sizeRange.value = String(clamp(size, 50, 120));
    els.sizeValue.textContent = `${size}%`;
    updateHook();
  }
  if (next.care) {
    care = { ...care, ...next.care };
    updateStats();
  }
  if (next.runtime) {
    runtime = { ...runtime, ...next.runtime };
    updateHook();
  }
}

function flashPreview(state, duration = 1100) {
  preview.setState(state, duration);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    preview.setState(agentState?.active ? agentState.state : "idle");
  }, duration);
}

/* Appearance ------------------------------------------------------------- */
els.nameInput.addEventListener("input", () => {
  const next = truncateName(els.nameInput.value);
  els.heroName.textContent = next || "Tofu";
  clearTimeout(nameTimer);
  if (!next) return;
  nameTimer = setTimeout(() => {
    profile.name = next;
    bridge.updateProfile({ name: next }).catch(() => {});
  }, 320);
});

els.nameInput.addEventListener("blur", () => {
  const next = truncateName(els.nameInput.value) || "Tofu";
  els.nameInput.value = next;
  els.heroName.textContent = next;
  if (next !== profile.name) {
    profile.name = next;
    bridge.updateProfile({ name: next }).catch(() => {});
  }
});

els.paletteRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-palette]");
  if (!button) return;
  const palette = button.dataset.palette;
  if (!PALETTES[palette]) return;
  profile.palette = palette;
  preview.setPalette(palette);
  document.querySelectorAll("[data-palette]").forEach((item) => {
    item.setAttribute("aria-checked", String(item === button));
  });
  bridge.updateProfile({ palette }).catch(() => {});
  showToast(`已换成 ${PALETTES[palette].label} 毛色`);
});

els.sizeRange.addEventListener("input", () => {
  const size = clamp(Number(els.sizeRange.value), 50, 120);
  els.sizeValue.textContent = `${size}%`;
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => {
    prefs.size = size / 100;
    bridge.updatePrefs({ size: size / 100 }).catch(() => {});
  }, 80);
});

/* Behavior --------------------------------------------------------------- */
document.querySelectorAll("[data-pref]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.pref;
    const value = !Boolean(prefs[key]);
    prefs[key] = value;
    button.setAttribute("aria-checked", String(value));
    preview.setReducedMotion(Boolean(prefs.reducedMotion));
    bridge.updatePrefs({ [key]: value }).catch(() => {});
    if (key === "ghost" && value) {
      showToast("幽灵模式已开。可在托盘菜单里关掉。");
    } else if (key === "launchAtLogin" && value) {
      showToast("下次登录系统时，Tofu 会自己出现。");
    }
  });
});

/* Hook server ------------------------------------------------------------ */
els.portInput.addEventListener("change", () => {
  const port = Math.round(clamp(Number(els.portInput.value), 1024, 65535));
  els.portInput.value = String(port);
  if (port === (runtime.hookPort || prefs.port)) return;
  prefs.port = port;
  bridge.updatePrefs({ port }).catch(() => {});
  showToast(`端口改为 ${port}，正在重启小服务…`);
});

els.copyCode.addEventListener("click", async () => {
  try {
    await bridge.copyText(els.hookCommand.textContent);
    showToast("命令已复制");
  } catch {
    showToast("复制失败，选中文字手动复制吧");
  }
});

document.querySelectorAll("[data-demo]").forEach((button) => {
  button.addEventListener("click", () => {
    const kind = button.dataset.demo;
    bridge.demo(kind).catch(() => {});
    if (kind === "fail") flashPreview("failed", 1800);
    else if (kind === "waiting") flashPreview("waiting", 2200);
    else if (kind === "done") flashPreview("waving", 1800);
    else flashPreview("working", 2500);
    showToast("已发事件，看看桌面上的 Tofu");
  });
});

/* Care ------------------------------------------------------------------- */
document.querySelectorAll("[data-care]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.care;
    const result = await bridge.care(action).catch(() => null);
    if (!result) {
      showToast("Tofu 没回应，可能睡着了");
      return;
    }
    if (result.care) {
      care = { ...care, ...result.care };
      updateStats();
    }
    if (result.ok === false && result.reason === "no-treats") {
      showToast("饼干盒空了");
      flashPreview("waiting", 900);
      return;
    }
    if (action === "feed") flashPreview("eating", 1800);
    else if (action === "play") flashPreview("jumping", 900);
    else if (action === "nap") flashPreview("sleeping", 1600);
    else flashPreview("happy", 900);
    showToast(
      action === "feed" ? "投喂成功" : action === "play" ? "玩得很开心" : action === "nap" ? "嘘…睡着了" : "咕噜咕噜",
    );
  });
});

/* Window controls -------------------------------------------------------- */
document.getElementById("minimize").addEventListener("click", () => bridge.minimizeSettings());
document.getElementById("close").addEventListener("click", () => bridge.closeSettings());

document.getElementById("reset-position").addEventListener("click", async () => {
  await bridge.resetPosition().catch(() => {});
  showToast("Tofu 被召回到桌面右下角");
});

const resetCareButton = document.getElementById("reset-care");
resetCareButton.addEventListener("click", async () => {
  if (!resetArmed) {
    resetArmed = true;
    resetCareButton.textContent = "再点一次";
    setTimeout(() => {
      resetArmed = false;
      resetCareButton.textContent = "重置状态";
    }, 2600);
    return;
  }
  resetArmed = false;
  resetCareButton.textContent = "重置状态";
  await bridge.resetCare().catch(() => {});
  showToast("状态已重置，重新认识一下");
});

document.getElementById("quit-app").addEventListener("click", () => {
  bridge.quit();
});

/* Live updates ----------------------------------------------------------- */
bridge.onState((next) => applyState(next));

bridge.onAgent((event) => {
  if (!event?.state) return;
  agentState = {
    active: Boolean(event.active),
    source: event.source || "agent",
    state: event.baseState || event.state,
  };
  const duration = event.duration || 1300;
  preview.setState(event.state, duration);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    preview.setState(agentState?.active ? agentState.state : "idle");
  }, duration);
  if (!event.active) {
    setTimeout(() => {
      agentState = null;
      updateHero();
    }, 2600);
  }
  updateHero();
});

// Let the preview occasionally look around, then settle back into idle.
setInterval(() => {
  if (agentState || document.hidden) return;
  if (Math.random() > 0.72) {
    preview.spawnSparkles(1);
  }
}, 9000);

populate();
