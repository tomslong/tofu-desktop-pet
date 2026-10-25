import { PetEngine, STATE_COPY } from "./pet-engine.js";
import { PetAudio } from "./audio.js";
import { copy, idleLine } from "./messages.js";

// Browser-only preview fallback. The real app always exposes window.tofu via
// the preload bridge; this keeps `pet.html` inspectable in a plain browser.
function browserPreviewBridge() {
  const state = {
    profile: { name: "Tofu", palette: "miso" },
    prefs: {
      size: 1,
      alwaysOnTop: true,
      ghost: false,
      sound: false,
      reducedMotion: false,
      launchAtLogin: false,
      agentHooks: true,
      port: 41234,
    },
    care: { joy: 82, energy: 74, treats: 3, headpats: 12 },
    runtime: { firstRun: true, appVersion: "1.0.0", platform: "web" },
  };
  const noop = async () => true;
  return {
    bootstrap: async () => structuredClone(state),
    care: async (action) => {
      const care = state.care;
      if (action === "pet") {
        care.joy += 3;
        care.headpats += 1;
      }
      if (action === "feed") {
        if (care.treats <= 0) return { ok: false, reason: "no-treats", care: { ...care } };
        care.treats -= 1;
        care.energy = Math.min(100, care.energy + 7);
      }
      if (action === "play") care.joy = Math.min(100, care.joy + 5);
      if (action === "nap") care.energy = Math.min(100, care.energy + 15);
      return { ok: true, care: { ...care } };
    },
    updateProfile: noop,
    updatePrefs: noop,
    openSettings: noop,
    hidePet: noop,
    showContextMenu: noop,
    markOnboardingSeen: noop,
    dragStart: noop,
    dragEnd: noop,
    setIgnoreMouse: noop,
    setBubbleVisible: noop,
    onState: () => {},
    onAgent: () => {},
    onCommand: () => {},
  };
}

const api = window.tofu || browserPreviewBridge();

const els = {
  root: document.getElementById("pet-root"),
  stage: document.getElementById("stage"),
  canvas: document.getElementById("pet"),
  dock: document.getElementById("dock"),
  dockName: document.getElementById("dock-name"),
  dockStatus: document.getElementById("dock-status"),
  bubble: document.getElementById("bubble"),
  bubbleText: document.getElementById("bubble-text"),
  bubbleClose: document.getElementById("bubble-close"),
  agentChip: document.getElementById("agent-chip"),
  agentLabel: document.getElementById("agent-label"),
  treatCount: document.getElementById("treat-count"),
};

const data = await api.bootstrap();
const profile = { ...data.profile };
const prefs = { ...data.prefs };
let care = { ...data.care };
let runtime = { ...data.runtime };
let ghost = Boolean(prefs.ghost);

const engine = new PetEngine(els.canvas, {
  palette: profile.palette,
  reducedMotion: prefs.reducedMotion,
});
const audio = new PetAudio(prefs.sound);

let dragging = false;
let dragStart = null;
let dragMoved = false;
let tapTimer = 0;
let lastTap = 0;
let transient = null;
let idleAt = Date.now();
let lastBubbleAt = 0;
let agent = {
  active: false,
  state: "idle",
  source: "",
  label: "",
  lastAt: 0,
};
let leaving = false;

const bubble = {
  typingTimer: 0,
  hideTimer: 0,
  token: 0,
  text: "",
  shift: 0,
};

function setBubbleShift(value) {
  const next = Math.max(0, Math.round(value));
  if (next === bubble.shift) return;
  bubble.shift = next;
  els.root.style.setProperty("--bubble-shift", `${next}px`);
}

// Long messages are allowed to move down and overlap the cat slightly instead
// of being clipped by the top edge of the transparent window.
function fitBubble() {
  if (!els.bubble || els.bubble.hidden) {
    setBubbleShift(0);
    return;
  }
  setBubbleShift(0);
  const top = els.bubble.getBoundingClientRect().top;
  if (top < 8) setBubbleShift(Math.min(160, 8 - top));
}

function titleCase(value = "") {
  return String(value)
    .replace(/[-_]/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function updatePetLayout() {
  const scale = Number(prefs.size) || 1;
  document.documentElement.style.setProperty("--pet-scale", String(scale));
  // The bubble follows the pet when it shrinks, but never below 72% or the
  // pixel font stops being readable. It does not grow past 100% either,
  // because that would make the card wider than the window.
  const bubbleScale = Math.max(0.72, Math.min(1, scale));
  document.documentElement.style.setProperty("--bubble-scale", bubbleScale.toFixed(3));
  // Keep the bubble anchored just above the scaled canvas, independent of
  // window height. The CSS --bubble-gap decides the actual visual distance.
  const canvasTop = window.innerHeight - 46 - 256 + 256 * 0.91 * (1 - scale);
  const anchor = Math.round(window.innerHeight - canvasTop);
  els.root.style.setProperty("--bubble-anchor", `${anchor}px`);
  requestAnimationFrame(fitBubble);
}

function applyProfile() {
  els.dockName.textContent = (profile.name || "Tofu").toUpperCase();
  engine.setPalette(profile.palette);
  updatePetLayout();
}

function applyPrefs() {
  ghost = Boolean(prefs.ghost);
  engine.setReducedMotion(Boolean(prefs.reducedMotion));
  audio.setEnabled(Boolean(prefs.sound));
  updatePetLayout();
  document.body.classList.toggle("ghost", ghost);
  els.root.classList.toggle("ghost-root", ghost);
}

function applyCare() {
  const treats = Number(care.treats) || 0;
  if (els.treatCount) {
    els.treatCount.hidden = treats <= 0;
    els.treatCount.textContent = String(treats);
  }
  els.dock.title = `心情 ${Math.round(care.joy)} · 精力 ${Math.round(care.energy)} · 饼干 ${treats}`;
  updateDock();
}

function showBubble(text, options = {}) {
  if (!text) return;
  const message = String(text).slice(0, 190);
  const duration = options.duration ?? 5400;
  bubble.token += 1;
  const token = bubble.token;
  clearInterval(bubble.typingTimer);
  clearTimeout(bubble.hideTimer);

  els.bubble.hidden = false;
  const bubbleState = api.setBubbleVisible?.(true);
  bubbleState?.catch?.(() => {});
  setBubbleShift(0);
  els.bubbleText.textContent = "";
  els.bubbleText.classList.add("typing");
  bubble.text = message;

  // Type it in a few characters at a time so long messages do not take forever.
  const chars = [...message];
  let index = 0;
  const step = Math.max(1, Math.ceil(chars.length / 70));
  bubble.typingTimer = window.setInterval(() => {
    if (token !== bubble.token) return;
    index = Math.min(chars.length, index + step);
    els.bubbleText.textContent = chars.slice(0, index).join("");
    fitBubble();
    if (index >= chars.length) {
      clearInterval(bubble.typingTimer);
      els.bubbleText.classList.remove("typing");
      bubble.hideTimer = window.setTimeout(() => {
        if (token === bubble.token) hideBubble();
      }, duration);
    }
  }, 24);

  lastBubbleAt = Date.now();
  if (api.markOnboardingSeen) api.markOnboardingSeen().catch(() => {});
}

function hideBubble() {
  bubble.token += 1;
  clearInterval(bubble.typingTimer);
  clearTimeout(bubble.hideTimer);
  els.bubbleText.classList.remove("typing");
  els.bubble.hidden = true;
  setBubbleShift(0);
  const bubbleState = api.setBubbleVisible?.(false);
  bubbleState?.catch?.(() => {});
}

function flashState(state, duration = 900) {
  transient = { state, until: performance.now() + duration };
  engine.setState(state, duration);
}

function setDragging(value) {
  dragging = value;
  if (value) {
    transient = null;
    engine.setState("dragged");
    updateDock();
  } else {
    updateDock();
  }
}

function updateDock() {
  if (!els.dockStatus) return;
  let label;
  if (dragging) {
    label = "wheee…";
  } else if (agent.active) {
    const src = agent.source ? `${agent.source.toUpperCase()} · ` : "";
    label = `${src}${STATE_COPY[agent.state] || agent.state}`;
  } else if (care.energy < 26) {
    label = "a little sleepy";
  } else if (care.joy > 86) {
    label = "very loved";
  } else if (care.treats <= 0) {
    label = "out of cookies";
  } else {
    label = "just vibing";
  }
  if (agent.active) {
    els.dockStatus.innerHTML = `<b>${escapeHtml(label)}</b>`;
  } else {
    els.dockStatus.textContent = label;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateAgentChip() {
  const recent = agent.active || Date.now() - agent.lastAt < 5000;
  els.agentChip.classList.toggle("visible", recent);
  els.agentChip.classList.toggle("busy", agent.active && agent.state !== "failed");
  els.agentChip.classList.toggle("error", agent.state === "failed");
  els.agentLabel.textContent = `${(agent.source || "agent").toUpperCase()} / ${(
    STATE_COPY[agent.state] || agent.state
  ).toUpperCase()}`;
}

function applyAgentEvent(event) {
  if (!event || !event.state) {
    if (event?.bubble) showBubble(event.bubble, { duration: event.duration ?? 5000 });
    return;
  }
  const now = Date.now();
  agent.state = event.baseState || event.state;
  if (typeof event.active === "boolean") agent.active = event.active;
  if (event.source) agent.source = String(event.source).slice(0, 24);
  agent.label = titleCase(agent.state);
  agent.lastAt = now;

  if (event.state === "waving" || event.state === "failed" || event.state === "jumping") {
    flashState(event.state, event.duration || 2800);
  } else if (event.duration) {
    transient = { state: event.state, until: performance.now() + event.duration };
    engine.setState(event.state, event.duration);
  }
  if (!event.active && event.state !== "failed" && event.state !== "waving") {
    transient = null;
  }

  if (event.bubble) {
    const priority = Boolean(event.priority) || ["stop", "failed", "waiting", "start", "bubble"].includes(event.phase);
    if (priority || now - lastBubbleAt > 3800) {
      showBubble(event.bubble, { duration: event.bubbleDuration || 5200 });
    }
  }
  if (event.phase === "stop") audio.done();
  if (event.phase === "failure" || event.state === "failed") audio.error();
  if (event.phase === "start" || event.state === "jumping") audio.play();
  if (event.state === "working") engine.trigger("sparkles");
  updateAgentChip();
  updateDock();
}

function syncState(now = performance.now()) {
  if (leaving) return;
  let next = "idle";

  if (dragging) {
    next = "dragged";
  } else if (transient && now < transient.until) {
    next = transient.state;
  } else if (agent.active) {
    next = agent.state;
    if (now - agent.lastAt > 150000) {
      // A dropped hook should not leave the cat typing forever.
      agent.active = false;
      next = "idle";
    }
  } else if (care.energy <= 12 || Date.now() - idleAt > 7 * 60 * 1000) {
    next = "sleeping";
  }

  if (engine.state !== next) engine.setState(next, transient?.until ? transient.until - now : 0);
  updateAgentChip();
}

async function doCare(action) {
  audio.unlock();
  if (action === "pet") {
    const result = await api.care("pet").catch(() => null);
    if (!result) return;
    care = { ...care, ...result.care };
    applyCare();
    flashState("happy", 900);
    showBubble(copy.pat(), { duration: 3600 });
    audio.pet();
    idleAt = Date.now();
  } else if (action === "feed") {
    const result = await api.care("feed").catch(() => null);
    if (!result) return;
    care = { ...care, ...result.care };
    applyCare();
    if (result.ok === false && result.reason === "no-treats") {
      flashState("waiting", 900);
      showBubble(copy.noTreats(), { duration: 3600 });
      audio.pop();
    } else if (result.ok === false) {
      showBubble("慢一点，饼干还在路上。", { duration: 2500 });
    } else {
      flashState("eating", 1900);
      engine.trigger("crumbs");
      showBubble(copy.feed(), { duration: 3600 });
      audio.feed();
    }
    idleAt = Date.now();
  } else if (action === "play") {
    const result = await api.care("play").catch(() => null);
    if (result) {
      care = { ...care, ...result.care };
      applyCare();
    }
    flashState("jumping", 1000);
    window.setTimeout(() => flashState("happy", 800), 950);
    showBubble(copy.play(), { duration: 3300 });
    audio.play();
    idleAt = Date.now();
  } else if (action === "nap") {
    const result = await api.care("nap").catch(() => null);
    if (result) {
      care = { ...care, ...result.care };
      applyCare();
    }
    transient = { state: "sleeping", until: performance.now() + 8000 };
    engine.setState("sleeping", 8000);
    showBubble(copy.nap(), { duration: 3000 });
    audio.nap();
    idleAt = Date.now();
  }
}

function handleTap() {
  const now = Date.now();
  if (now - lastTap < 340) {
    lastTap = 0;
    clearTimeout(tapTimer);
    doCare("play");
    return;
  }
  lastTap = now;
  clearTimeout(tapTimer);
  tapTimer = window.setTimeout(() => doCare("pet"), 250);
}

function endDrag() {
  if (!dragStart) return;
  dragStart = null;
  api.dragEnd().catch?.(() => {});
  if (dragMoved) {
    setDragging(false);
    idleAt = Date.now();
    showBubble("这里视野不错。", { duration: 2600 });
    audio.pop();
  }
  dragMoved = false;
}

els.stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || ghost) return;
  audio.unlock();
  dragStart = { x: event.screenX, y: event.screenY, time: Date.now() };
  dragMoved = false;
  els.stage.setPointerCapture?.(event.pointerId);
  api.dragStart().catch(() => {});
});

els.stage.addEventListener("pointermove", (event) => {
  const rect = els.canvas.getBoundingClientRect();
  if (rect.width > 0) {
    engine.setPointer({
      x: ((event.clientX - rect.left) / rect.width) * 64,
      y: ((event.clientY - rect.top) / rect.height) * 64,
    });
  }
  if (!dragStart) return;
  const dist = Math.hypot(event.screenX - dragStart.x, event.screenY - dragStart.y);
  if (!dragMoved && dist > 5) {
    dragMoved = true;
    clearTimeout(tapTimer);
    tapTimer = 0;
    setDragging(true);
    showBubble(copy.drag(), { duration: 1500 });
  }
});

els.stage.addEventListener("pointerleave", () => {
  if (!dragStart) engine.setPointer(null);
});

els.stage.addEventListener("pointerup", (event) => {
  if (!dragStart) return;
  const wasDrag = dragMoved;
  endDrag();
  if (!wasDrag && event.button === 0) handleTap();
});

els.stage.addEventListener("pointercancel", endDrag);
els.stage.addEventListener("lostpointercapture", () => {
  if (dragStart) endDrag();
});
els.stage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (ghost) return;
  setIgnoreMouse(false);
  api.showContextMenu().catch(() => {});
});

els.stage.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    doCare("pet");
  }
});

els.dock.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || ghost) return;
  const action = button.dataset.action;
  if (action === "settings") {
    api.openSettings().catch(() => {});
    return;
  }
  doCare(action);
});

els.dock.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (ghost) return;
  setIgnoreMouse(false);
  api.showContextMenu().catch(() => {});
});

els.bubbleClose.addEventListener("click", (event) => {
  event.stopPropagation();
  hideBubble();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideBubble();
});

window.addEventListener("blur", () => {
  if (dragStart) endDrag();
});

api.onState((next) => {
  if (!next) return;
  if (next.profile) {
    Object.assign(profile, next.profile);
    applyProfile();
  }
  if (next.prefs) {
    Object.assign(prefs, next.prefs);
    applyPrefs();
  }
  if (next.care) {
    care = { ...care, ...next.care };
    applyCare();
  }
  if (next.runtime) runtime = { ...runtime, ...next.runtime };
  if (next.runtime?.agent) applyAgentEvent(next.runtime.agent);
  updateDock();
});

api.onAgent((event) => applyAgentEvent(event));

window.addEventListener("resize", updatePetLayout);

api.onCommand((command) => {
  if (!command) return;
  if (command.action === "feed" || command.action === "play" || command.action === "nap") {
    doCare(command.action);
  } else if (command.action === "pet") {
    doCare("pet");
  } else if (command.action === "bubble" && command.text) {
    showBubble(command.text, { duration: 5000 });
  } else if (command.action === "hide") {
    leaving = true;
    els.root.classList.add("leaving");
    setTimeout(() => api.hidePet().catch?.(() => {}), 170);
  }
});

// Initial sync ----------------------------------------------------------------
applyProfile();
applyPrefs();
applyCare();
updateDock();
engine.start();

const previewParams = new URLSearchParams(location.search);
const browserPreview = !window.tofu;
if (browserPreview && STATE_COPY[previewParams.get("state")]) {
  const state = previewParams.get("state");
  transient = { state, until: Infinity };
  engine.setState(state, Number(previewParams.get("duration")) || 0);
}
if (browserPreview && previewParams.has("nobubble")) hideBubble();

if (!browserPreview && runtime.firstRun) {
  setTimeout(() => {
    showBubble(copy.firstRun(), { duration: 7200 });
  }, 700);
} else if (!previewParams.has("nobubble")) {
  const hour = new Date().getHours();
  setTimeout(() => showBubble(idleLine(hour), { duration: 4200 }), 1200);
}

// Lightweight ambient chatter. It never interrupts an agent or a care action.
setInterval(() => {
  if (document.hidden || dragging || agent.active) return;
  if (Date.now() - idleAt < 90000) return;
  if (Math.random() > 0.28) return;
  const state = engine.state;
  if (state === "sleeping" || state === "eating" || state === "happy") return;
  showBubble(idleLine(new Date().getHours()), { duration: 4300 });
  idleAt = Date.now();
}, 32000);

// Sleepy breathing pauses are handled by the engine, but a low battery cat
// should occasionally tell you why it is horizontal.
setInterval(() => {
  if (care.energy <= 14 && !agent.active && !dragging && Math.random() > 0.6) {
    showBubble("电量不足，申请睡五分钟。", { duration: 3800 });
  }
}, 90000);

syncState();
setInterval(syncState, 220);
setInterval(updateAgentChip, 1200);

// Keep the dock honest when the window has been idle for a long time.
setInterval(() => {
  if (!agent.active && Date.now() - idleAt > 8 * 60 * 1000) {
    engine.setState("sleeping");
  }
}, 30000);
