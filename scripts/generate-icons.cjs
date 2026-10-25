/* Generate the app and tray icons with a headless Chrome canvas.
 * Run with: npm run icons
 */
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const PAGE = `<!doctype html>
<html><body style="margin:0;background:transparent">
<canvas id="c" width="512" height="512"></canvas>
<script>
const C = {
  ink: "#241c17",
  cream: "#f7e8cb",
  creamShade: "#e6cfa8",
  orange: "#e79a5d",
  orangeDark: "#c97a42",
  pink: "#d98a8f",
  teal: "#2f7f70",
  mint: "#5bb79e",
  coral: "#eb654b",
  paper: "#fff8e9"
};

function rr(ctx, x, y, w, h, r, color) {
  for (let dy = 0; dy < h; dy++) {
    let inset = 0;
    if (dy < r) {
      const edge = r - dy - 0.5;
      inset = Math.round(r - Math.sqrt(Math.max(0, r * r - edge * edge)));
    } else if (dy >= h - r) {
      const edge = dy - (h - r) + 0.5;
      inset = Math.round(r - Math.sqrt(Math.max(0, r * r - edge * edge)));
    }
    ctx.fillStyle = color;
    ctx.fillRect(x + inset, y + dy, w - inset * 2, 1);
  }
}

function tri(ctx, ax, ay, bx, by, cx, cy, color) {
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    const edges = [[ax,ay,bx,by],[bx,by,cx,cy],[cx,cy,ax,ay]];
    for (const [x1,y1,x2,y2] of edges) {
      if (y1 === y2) continue;
      if (y < Math.min(y1,y2) || y > Math.max(y1,y2)) continue;
      const t = (y - y1) / (y2 - y1);
      xs.push(x1 + (x2 - x1) * t);
    }
    if (xs.length < 2) continue;
    const left = Math.round(Math.min(...xs));
    const right = Math.round(Math.max(...xs));
    ctx.fillStyle = color;
    ctx.fillRect(left, y, Math.max(1, right - left), 1);
  }
}

function cat(ctx, unit) {
  // ears
  tri(ctx, 5*unit, 11*unit, 9*unit, 3*unit, 13*unit, 11*unit, C.ink);
  tri(ctx, 7*unit, 10*unit, 9*unit, 5*unit, 11*unit, 10*unit, C.cream);
  tri(ctx, 8*unit, 9*unit, 9*unit, 6*unit, 10*unit, 9*unit, C.pink);
  tri(ctx, 27*unit, 11*unit, 23*unit, 3*unit, 19*unit, 11*unit, C.ink);
  tri(ctx, 25*unit, 10*unit, 23*unit, 5*unit, 21*unit, 10*unit, C.orange);
  tri(ctx, 24*unit, 9*unit, 23*unit, 6*unit, 22*unit, 9*unit, C.pink);

  // head
  rr(ctx, 3*unit, 7*unit, 26*unit, 21*unit, 8*unit, C.ink);
  rr(ctx, 5*unit, 9*unit, 22*unit, 17*unit, 6*unit, C.cream);

  // orange patch
  ctx.fillStyle = C.orange;
  const patch = [
    [9,21,26],[10,19,27],[11,18,27],[12,18,26],[13,19,26],[14,20,25]
  ];
  for (const [y,x1,x2] of patch) {
    ctx.fillRect(x1*unit, y*unit, (x2-x1+1)*unit, unit);
  }
  ctx.fillRect(20*unit, 15*unit, 3*unit, unit);

  // eyes
  ctx.fillStyle = C.ink;
  ctx.fillRect(10*unit, 15*unit, 3*unit, 4*unit);
  ctx.fillRect(19*unit, 15*unit, 3*unit, 4*unit);
  ctx.fillStyle = C.paper;
  ctx.fillRect(11*unit, 16*unit, unit, unit);
  ctx.fillRect(20*unit, 16*unit, unit, unit);
  ctx.fillStyle = C.creamShade;
  ctx.fillRect(10*unit, 15*unit, 3*unit, unit);
  ctx.fillRect(19*unit, 15*unit, 3*unit, unit);

  // blush and nose
  ctx.fillStyle = "rgba(217,138,143,0.65)";
  ctx.fillRect(7*unit, 19*unit, 2*unit, unit);
  ctx.fillRect(23*unit, 19*unit, 2*unit, unit);
  ctx.fillStyle = C.pink;
  ctx.fillRect(15*unit, 19*unit, 2*unit, unit);
  ctx.fillRect(16*unit, 20*unit, unit, unit);
  ctx.fillStyle = C.ink;
  ctx.fillRect(14*unit, 21*unit, unit, unit);
  ctx.fillRect(17*unit, 21*unit, unit, unit);
  ctx.fillRect(15*unit, 22*unit, 2*unit, unit);

  // scarf
  rr(ctx, 4*unit, 24*unit, 24*unit, 5*unit, unit, C.ink);
  rr(ctx, 5*unit, 25*unit, 22*unit, 3*unit, unit, C.teal);
  ctx.fillStyle = C.mint;
  ctx.fillRect(7*unit, 26*unit, 10*unit, unit);
  rr(ctx, 24*unit, 26*unit, 5*unit, 4*unit, unit, C.ink);
  rr(ctx, 25*unit, 27*unit, 3*unit, 2*unit, unit, C.teal);
  ctx.fillStyle = C.teal;
  ctx.fillRect(27*unit, 29*unit, 3*unit, 2*unit);
  ctx.fillRect(29*unit, 28*unit, 2*unit, 2*unit);
  ctx.fillStyle = C.ink;
  ctx.fillRect(29*unit, 31*unit, 2*unit, unit);

  // shine
  ctx.fillStyle = C.paper;
  ctx.fillRect(7*unit, 10*unit, 2*unit, unit);
  ctx.fillRect(6*unit, 11*unit, unit, 2*unit);
}

function drawIcon(size, withBackground) {
  const canvas = document.getElementById("c");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const unit = size / 32;

  if (withBackground) {
    rr(ctx, 0, 0, 32*unit, 32*unit, 6*unit, C.ink);
    rr(ctx, 2*unit, 2*unit, 28*unit, 28*unit, 5*unit, C.coral);
    // tiny paper sparkles in the coral field
    ctx.fillStyle = "rgba(255,248,233,0.75)";
    ctx.fillRect(4*unit, 5*unit, unit, unit);
    ctx.fillRect(6*unit, 3*unit, unit, unit);
    ctx.fillRect(27*unit, 6*unit, unit, unit);
    ctx.fillRect(28*unit, 4*unit, unit, unit);
    ctx.fillStyle = "rgba(36,28,23,0.18)";
    ctx.fillRect(4*unit, 27*unit, 4*unit, unit);
    ctx.fillRect(6*unit, 29*unit, 2*unit, unit);
    cat(ctx, unit);
  } else {
    cat(ctx, unit);
  }
  return canvas.toDataURL("image/png");
}
window.drawIcon = drawIcon;
</script>
</body></html>`;

(async () => {
  if (!fs.existsSync(CHROME)) {
    console.error(`[tofu] Chrome not found at ${CHROME}. Set CHROME_PATH to generate icons.`);
    process.exit(1);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setContent(PAGE, { waitUntil: "load" });
  const iconUrl = await page.evaluate(() => drawIcon(512, true));
  const trayUrl = await page.evaluate(() => drawIcon(32, false));
  const out = path.join(__dirname, "..", "assets");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "icon.png"), Buffer.from(iconUrl.split(",")[1], "base64"));
  fs.writeFileSync(path.join(out, "tray.png"), Buffer.from(trayUrl.split(",")[1], "base64"));
  console.log("[tofu] wrote assets/icon.png and assets/tray.png");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
