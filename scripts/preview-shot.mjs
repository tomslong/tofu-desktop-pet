/* Visual QA helper: serves the renderer over HTTP and screenshots it in
 * headless Chrome. Not part of the shipped app. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, ".shots");
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === "/") file = path.join(ROOT, "src", "pet.html");
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("no");
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

fs.mkdirSync(SHOTS, { recursive: true });
const server = await startServer();
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb"],
});

const errors = [];

async function newPage(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return page;
}

try {
  const pet = await newPage(340, 450);
  await pet.goto(`http://127.0.0.1:${port}/src/pet.html`, { waitUntil: "networkidle0" });
  await pet.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await pet.screenshot({ path: path.join(SHOTS, "pet-intro.png"), omitBackground: true });

  // Dismiss the intro card so the cat itself can be inspected cleanly.
  await pet.evaluate(() => document.getElementById("bubble-close").click());
  await new Promise((resolve) => setTimeout(resolve, 500));
  await pet.screenshot({ path: path.join(SHOTS, "pet-idle.png"), omitBackground: true });

  // Hover and pet the cat; capture the happy reaction + hearts.
  await pet.hover("#stage");
  await pet.mouse.click(170, 305);
  await new Promise((resolve) => setTimeout(resolve, 420));
  await pet.screenshot({ path: path.join(SHOTS, "pet-happy.png"), omitBackground: true });

  // Every animation state, for visual QA.
  for (const state of [
    "working",
    "review",
    "waiting",
    "failed",
    "waving",
    "sleeping",
    "happy",
    "eating",
    "dragged",
    "jumping",
  ]) {
    const page = await newPage(340, 450);
    await page.goto(
      `http://127.0.0.1:${port}/src/pet.html?state=${state}&nobubble=1&duration=1600`,
      { waitUntil: "networkidle0" },
    );
    await page.evaluate(() => document.fonts.ready);
    await new Promise((resolve) => setTimeout(resolve, state === "jumping" ? 320 : 700));
    await page.screenshot({
      path: path.join(SHOTS, `state-${state}.png`),
      omitBackground: true,
    });
    await page.close();
  }

  const settings = await newPage(500, 720);
  await settings.goto(`http://127.0.0.1:${port}/src/settings.html`, { waitUntil: "networkidle0" });
  await settings.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await settings.screenshot({ path: path.join(SHOTS, "settings.png") });

  // Exercise a few controls so the screenshot verifies real state.
  await settings.click('[data-palette="taro"]');
  await settings.click('[data-pref="ghost"]');
  await new Promise((resolve) => setTimeout(resolve, 700));
  await settings.screenshot({ path: path.join(SHOTS, "settings-interacted.png") });

  await settings.evaluate(() => {
    document.getElementById("settings-scroll").scrollTop = 710;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settings.screenshot({ path: path.join(SHOTS, "settings-mid.png") });

  await settings.evaluate(() => {
    const scroll = document.getElementById("settings-scroll");
    scroll.scrollTop = scroll.scrollHeight;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settings.screenshot({ path: path.join(SHOTS, "settings-bottom.png") });

  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        errors,
        shots: fs.readdirSync(SHOTS).filter((name) => name.endsWith(".png")),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.close();
}
