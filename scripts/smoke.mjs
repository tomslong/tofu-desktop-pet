/* Headless smoke test for the renderer, the hook server and persistence.
 * Run with: npm run smoke
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const { createHookServer } = require("../electron/hook-server.cjs");
const { Store } = require("../electron/store.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const results = [];
let failures = 0;

function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  failures += 1;
  results.push({ ok: false, name, detail: String(error?.message || error) });
  console.error(`FAIL  ${name} — ${error?.message || error}`);
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function mimeFor(file) {
  const map = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".json": "application/json",
  };
  return map[path.extname(file)] || "application/octet-stream";
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === "/") file = path.join(ROOT, "src", "pet.html");
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": mimeFor(file), "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function checkFiles() {
  const required = [
    "package.json",
    "electron/main.cjs",
    "electron/preload.cjs",
    "electron/hook-server.cjs",
    "src/pet.html",
    "src/settings.html",
    "src/renderer/pet-engine.js",
    "src/renderer/pet.js",
    "src/renderer/settings.js",
    "bin/tofu-hook.mjs",
    "assets/icon.png",
    "assets/tray.png",
    "assets/fonts/FusionPixel12-zh.woff2",
    "assets/fonts/OFL-FusionPixel.txt",
    "README.md",
    "docs/HOOKS.md",
  ];
  for (const relative of required) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `missing ${relative}`);
  }
}

async function checkStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tofu-store-"));
  const file = path.join(dir, "state.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      profile: { name: "Smoke" },
      prefs: { sound: false, size: 2.5 },
      care: { joy: 42 },
    }),
  );
  const store = new Store(file);
  assert.equal(store.get().profile.name, "Smoke");
  assert.equal(store.get().prefs.sound, false);
  assert.equal(store.get().prefs.size, 1.2, "stored scale should be clamped to 120%");
  assert.equal(store.get().care.joy, 42);
  assert.equal(store.get().profile.palette, "miso", "defaults should be merged");
  store.get().profile.palette = "taro";
  store.saveNow();
  const reloaded = new Store(file);
  assert.equal(reloaded.get().profile.palette, "taro");
  fs.rmSync(dir, { recursive: true, force: true });
}

async function checkHookServer() {
  const port = 43900 + Math.floor(Math.random() * 60);
  let received = null;
  const server = createHookServer({
    version: "smoke",
    getState: () => "idle",
    onEvent: async (payload) => {
      received = payload;
      return { state: "working", active: true };
    },
  });
  const started = await server.start(port);
  assert.equal(started.ok, true, started.error);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.json());
    assert.equal(health.ok, true);
    assert.equal(health.app, "tofu");
    assert.equal(health.port, port);

    const response = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pre", tool: "edit", source: "smoke" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, "working");
    assert.equal(received.type, "pre");
    assert.equal(received.tool, "edit");
    assert.equal(received.source, "smoke");

    const missing = await fetch(`http://127.0.0.1:${port}/bubble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);

    const origin = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ type: "pre" }),
    });
    assert.equal(origin.status, 403);
  } finally {
    await server.stop();
  }
}

async function checkBrowser() {
  assert.ok(fs.existsSync(CHROME), `Chrome not found at ${CHROME}`);
  const staticServer = await startStaticServer();
  const port = staticServer.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });
  const errors = [];
  try {
    const pet = await browser.newPage();
    await pet.setViewport({ width: 340, height: 450, deviceScaleFactor: 1 });
    pet.on("pageerror", (error) => errors.push(String(error)));
    pet.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await pet.goto(`http://127.0.0.1:${port}/src/pet.html?state=idle&nobubble=1`, {
      waitUntil: "networkidle0",
    });
    await pet.evaluate(() => document.fonts.ready);

    const canvas = await pet.evaluate(() => {
      const c = document.getElementById("pet");
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
      return { painted, state: window.__tofuState || null };
    });
    assert.ok(canvas.painted > 500, `canvas only has ${canvas.painted} painted pixels`);

    await pet.mouse.click(170, 300);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterPat = await pet.evaluate(() => ({
      bubble: document.getElementById("bubble-text").textContent,
      hidden: document.getElementById("bubble").hidden,
      headpats: window.__tofuSmokeCare?.headpats ?? null,
    }));
    assert.equal(afterPat.hidden, false, "bubble should open after petting");
    assert.ok(afterPat.bubble.length > 0, "bubble should contain a message");

    const lowBattery = await browser.newPage();
    await lowBattery.goto(`http://127.0.0.1:${port}/src/pet.html?state=sleeping&nobubble=1`, {
      waitUntil: "networkidle0",
    });
    const sleepFrame = await lowBattery.evaluate(() => {
      const c = document.getElementById("pet");
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
      return painted;
    });
    assert.ok(sleepFrame > 500, "sleeping state should render");

    const settings = await browser.newPage();
    await settings.setViewport({ width: 500, height: 720, deviceScaleFactor: 1 });
    settings.on("pageerror", (error) => errors.push(String(error)));
    await settings.goto(`http://127.0.0.1:${port}/src/settings.html`, {
      waitUntil: "networkidle0",
    });
    await settings.evaluate(() => document.fonts.ready);

    const info = await settings.evaluate(() => ({
      sections: document.querySelectorAll(".section").length,
      hook: document.getElementById("hook-label").textContent,
      command: document.getElementById("hook-command").textContent,
      sizeMin: document.getElementById("size-range").min,
      sizeMax: document.getElementById("size-range").max,
      title: document.title,
      scrollHeight: document.getElementById("settings-scroll").scrollHeight,
      clientHeight: document.getElementById("settings-scroll").clientHeight,
      uncaught: window.__tofuSettingsError || null,
    }));
    assert.ok(info.sections >= 4, "settings sections missing");
    assert.equal(info.hook, "LISTENING");
    assert.match(info.command, /tofu-hook\.mjs/);
    assert.equal(info.sizeMin, "50");
    assert.equal(info.sizeMax, "120");
    assert.ok(info.scrollHeight > info.clientHeight, "settings should be scrollable");

    await settings.click('[data-palette="taro"]');
    const selected = await settings.$eval('[data-palette="taro"]', (el) => el.getAttribute("aria-checked"));
    assert.equal(selected, "true");

    await settings.evaluate(() => {
      const input = document.getElementById("name-input");
      input.value = "Smoke";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const heroName = await settings.$eval("#hero-name-text", (el) => el.textContent);
    assert.equal(heroName, "Smoke");

    await settings.click('[data-pref="ghost"]');
    const ghost = await settings.$eval('[data-pref="ghost"]', (el) => el.getAttribute("aria-checked"));
    assert.equal(ghost, "true");

    const cleanErrors = errors.filter((message) => !/favicon/i.test(message));
    assert.deepEqual(cleanErrors, [], `renderer console errors: ${cleanErrors.join(" | ")}`);
  } finally {
    await browser.close();
    staticServer.close();
  }
}

console.log("TOFU smoke test\n");
await check("required files", checkFiles);
await check("store persistence", checkStore);
await check("hook server", checkHookServer);
await check("renderer + settings", checkBrowser);

console.log(`\n${results.filter((item) => item.ok).length}/${results.length} checks passed`);
if (failures > 0) process.exit(1);
