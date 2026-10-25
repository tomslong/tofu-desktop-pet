/* Tofu's hand-drawn pixel cat. Everything is rendered from rectangles: no sprite
 * sheets, no external art. The canvas is a 64x64 pixel stage that is scaled up
 * with nearest-neighbour filtering by CSS. */

export const PALETTES = {
  miso: {
    label: "Miso",
    hint: "warm apricot",
    accent: "#e79a5d",
    accentDark: "#c97a42",
    scarf: "#2f7f70",
    scarfLight: "#5bb79e",
    innerEar: "#d98a8f",
    swatch: "#e79a5d",
  },
  matcha: {
    label: "Matcha",
    hint: "soft garden green",
    accent: "#9dbb69",
    accentDark: "#789847",
    scarf: "#d96f51",
    scarfLight: "#f29a7c",
    innerEar: "#dd9292",
    swatch: "#9dbb69",
  },
  taro: {
    label: "Taro",
    hint: "sleepy lavender",
    accent: "#b79bcd",
    accentDark: "#9077a6",
    scarf: "#e6ae4f",
    scarfLight: "#f5ce7d",
    innerEar: "#dd94a8",
    swatch: "#b79bcd",
  },
  yuzu: {
    label: "Yuzu",
    hint: "citrus sunshine",
    accent: "#ecc65f",
    accentDark: "#c8a13c",
    scarf: "#4d78a8",
    scarfLight: "#7fa8d1",
    innerEar: "#da8f8a",
    swatch: "#ecc65f",
  },
};

export const STATE_COPY = {
  idle: "chilling",
  working: "working",
  review: "reviewing",
  waiting: "waiting",
  failed: "uh oh",
  waving: "saying hi",
  jumping: "excited",
  sleeping: "napping",
  happy: "purring",
  eating: "snacking",
  dragged: "wheee",
};

const W = 64;
const H = 64;

const C = {
  ink: "#241c17",
  inkSoft: "#6f5b49",
  cream: "#f7e8cb",
  creamLight: "#fff8e9",
  creamShade: "#e6cfa8",
  creamDeep: "#d4b98f",
  white: "#fffdf4",
  blush: "rgba(213, 121, 122, 0.42)",
  pink: "#e68f96",
  pinkDark: "#c86b79",
  tongue: "#e58a88",
  tear: "#7cb9cf",
  danger: "#df5b45",
  screen: "#152722",
  mint: "#9ee0c1",
  shadow: "rgba(51, 36, 23, 0.17)",
};

function rect(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function rr(ctx, x, y, w, h, r, color) {
  r = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
  for (let dy = 0; dy < h; dy += 1) {
    let inset = 0;
    if (dy < r) {
      const edge = r - dy - 0.5;
      inset = Math.round(r - Math.sqrt(Math.max(0, r * r - edge * edge)));
    } else if (dy >= h - r) {
      const edge = dy - (h - r) + 0.5;
      inset = Math.round(r - Math.sqrt(Math.max(0, r * r - edge * edge)));
    }
    rect(ctx, x + inset, y + dy, w - inset * 2, 1, color);
  }
}

function shell(ctx, x, y, w, h, r, fill, outline = C.ink, thickness = 2) {
  rr(ctx, x, y, w, h, r, outline);
  rr(ctx, x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, Math.max(1, r - thickness), fill);
}

function circle(ctx, cx, cy, radius, color) {
  for (let y = -radius; y <= radius; y += 1) {
    const span = Math.floor(Math.sqrt(Math.max(0, radius * radius - y * y)));
    rect(ctx, cx - span, cy + y, span * 2 + 1, 1, color);
  }
}

function triangle(ctx, ax, ay, bx, by, cx, cy, color) {
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  for (let y = minY; y <= maxY; y += 1) {
    const xs = [];
    const edges = [
      [ax, ay, bx, by],
      [bx, by, cx, cy],
      [cx, cy, ax, ay],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      if (y1 === y2) continue;
      if (y < Math.min(y1, y2) || y > Math.max(y1, y2)) continue;
      const t = (y - y1) / (y2 - y1);
      xs.push(x1 + (x2 - x1) * t);
    }
    if (xs.length < 2) continue;
    const left = Math.round(Math.min(...xs));
    const right = Math.round(Math.max(...xs));
    rect(ctx, left, y, Math.max(1, right - left), 1, color);
  }
}

function thickLine(ctx, points, color, width) {
  for (let p = 0; p < points.length - 1; p += 1) {
    const [x1, y1] = points[p];
    const [x2, y2] = points[p + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Math.round(x1 + (x2 - x1) * t - width / 2);
      const y = Math.round(y1 + (y2 - y1) * t - width / 2);
      rect(ctx, x, y, width, width, color);
    }
  }
}

function heart(ctx, x, y, color, size = 1) {
  const map = [
    "01101",
    "11111",
    "11111",
    "01110",
    "00100",
  ];
  map.forEach((row, ry) => {
    [...row].forEach((cell, rx) => {
      if (cell === "1") rect(ctx, x + rx * size, y + ry * size, size, size, color);
    });
  });
}

function sparkle(ctx, x, y, color) {
  rect(ctx, x + 1, y, 1, 1, color);
  rect(ctx, x, y + 1, 3, 1, color);
  rect(ctx, x + 1, y + 2, 1, 1, color);
}

function zGlyph(ctx, x, y, color, size = 1) {
  const map = ["111", "001", "010", "100", "111"];
  map.forEach((row, ry) => {
    [...row].forEach((cell, rx) => {
      if (cell === "1") rect(ctx, x + rx * size, y + ry * size, size, size, color);
    });
  });
}

function question(ctx, x, y, color) {
  const map = ["111", "001", "011", "010", "000", "010"];
  map.forEach((row, ry) => {
    [...row].forEach((cell, rx) => {
      if (cell === "1") rect(ctx, x + rx, y + ry, 1, 1, color);
    });
  });
}

function bang(ctx, x, y, color) {
  rect(ctx, x, y, 2, 5, color);
  rect(ctx, x, y + 6, 2, 2, color);
}

function drawShadow(ctx, squash = 1, offsetY = 0, alpha = C.shadow) {
  const width = Math.round(28 * squash);
  const left = 32 - Math.round(width / 2);
  rect(ctx, left + 4, 56 + offsetY, width - 8, 4, alpha);
  rect(ctx, left, 57 + offsetY, width, 2, alpha);
  rect(ctx, left + 9, 55 + offsetY, width - 18, 1, alpha);
}

function drawTail(ctx, palette, phase, pose) {
  const sets = [
    [[43, 49], [50, 52], [55, 49], [56, 44], [53, 40]],
    [[43, 49], [51, 52], [57, 48], [57, 42], [54, 38]],
    [[43, 49], [50, 52], [55, 50], [55, 45], [52, 41]],
    [[43, 49], [50, 51], [54, 48], [53, 43], [50, 40]],
  ];
  let points = sets[phase % sets.length];
  if (pose.tailUp) {
    points = points.map(([x, y], i) => [x + (i > 1 ? 2 : 0), y - (i > 2 ? 5 : 0)]);
  }
  if (pose.tailStraight) {
    points = [[43, 50], [51, 51], [57, 48], [59, 43], [58, 38]];
  }
  thickLine(ctx, points, C.ink, 5);
  thickLine(ctx, points, C.cream, 3);
  const tip = points.slice(-2);
  thickLine(ctx, tip, palette.accent, 3);
  thickLine(ctx, [tip[1], [tip[1][0] + 1, tip[1][1] - 1]], palette.accentDark, 2);
}

function drawBody(ctx, palette, bob, breath) {
  shell(ctx, 18, 32 + bob, 28, 26, 9, C.cream);
  // warm side shade keeps the silhouette from looking flat
  rect(ctx, 41, 39 + bob, 2, 13, C.creamShade);
  rect(ctx, 21, 53 + bob, 22, 2, C.creamShade);
  // a tiny chest tuft
  rect(ctx, 29, 40 + bob, 6, 1, C.creamLight);
  rect(ctx, 31, 41 + bob, 2, 1, C.creamShade);
  if (breath) rect(ctx, 24, 47 + bob, 16, 1, C.creamLight);
}

function drawEar(ctx, palette, side, hx, hy, twitch = 0, droop = 0) {
  let outer;
  let inner;
  let pink;
  if (side === "left") {
    outer = [[9 + hx, 13 + hy], [16 + hx + twitch, 0 + hy + droop], [25 + hx, 13 + hy]];
    inner = [[12 + hx, 12 + hy], [16 + hx + twitch, 4 + hy + droop], [22 + hx, 12 + hy]];
    pink = [[14 + hx, 11 + hy], [16 + hx + twitch, 7 + hy + droop], [20 + hx, 11 + hy]];
  } else {
    outer = [[55 + hx, 13 + hy], [48 + hx + twitch, 0 + hy + droop], [39 + hx, 13 + hy]];
    inner = [[52 + hx, 12 + hy], [48 + hx + twitch, 4 + hy + droop], [42 + hx, 12 + hy]];
    pink = [[50 + hx, 11 + hy], [48 + hx + twitch, 7 + hy + droop], [44 + hx, 11 + hy]];
  }
  triangle(ctx, outer[0][0], outer[0][1], outer[1][0], outer[1][1], outer[2][0], outer[2][1], C.ink);
  triangle(
    ctx,
    inner[0][0],
    inner[0][1],
    inner[1][0],
    inner[1][1],
    inner[2][0],
    inner[2][1],
    side === "right" ? palette.accent : C.cream,
  );
  triangle(
    ctx,
    pink[0][0],
    pink[0][1],
    pink[1][0],
    pink[1][1],
    pink[2][0],
    pink[2][1],
    palette.innerEar,
  );
}

function drawPatch(ctx, palette, hx, hy) {
  const rows = [
    [11, 40, 46],
    [12, 37, 48],
    [13, 35, 49],
    [14, 34, 49],
    [15, 34, 48],
    [16, 35, 47],
    [17, 38, 46],
    [18, 40, 45],
  ];
  for (const [y, x1, x2] of rows) rect(ctx, hx + x1, hy + y, x2 - x1 + 1, 1, palette.accent);
  rect(ctx, hx + 44, hy + 19, 2, 1, palette.accent);
  rect(ctx, hx + 42, hy + 20, 2, 1, palette.accent);
  rect(ctx, hx + 14, hy + 16, 2, 1, palette.accent);
}

function drawHead(ctx, palette, hx, hy, twitch = 0, droop = 0) {
  // Ears live behind the skull. The head outline crosses their base, which is
  // what makes them read as cat ears instead of horns.
  drawEar(ctx, palette, "left", hx, hy, twitch, droop);
  drawEar(ctx, palette, "right", hx, hy, twitch, droop);
  shell(ctx, 11 + hx, 8 + hy, 42, 31, 12, C.cream);
  // light rim on the top left, shade along the lower right
  rect(ctx, hx + 16, hy + 11, 5, 1, C.creamLight);
  rect(ctx, hx + 13, hy + 13, 2, 4, C.creamLight);
  rect(ctx, hx + 49, hy + 20, 2, 9, C.creamShade);
  rect(ctx, hx + 46, hy + 32, 4, 1, C.creamShade);
  drawPatch(ctx, palette, hx, hy);
}

function drawEye(ctx, x, y, kind, lookX = 0, lookY = 0) {
  if (kind === "blink") {
    rect(ctx, x, y + 3, 6, 1, C.ink);
    rect(ctx, x + 1, y + 4, 1, 1, C.creamShade);
    return;
  }
  if (kind === "happy") {
    rect(ctx, x, y + 4, 1, 1, C.ink);
    rect(ctx, x + 1, y + 3, 1, 1, C.ink);
    rect(ctx, x + 2, y + 2, 2, 1, C.ink);
    rect(ctx, x + 4, y + 3, 1, 1, C.ink);
    rect(ctx, x + 5, y + 4, 1, 1, C.ink);
    return;
  }
  if (kind === "sleepy" || kind === "closed") {
    rect(ctx, x, y + 4, 2, 1, C.ink);
    rect(ctx, x + 2, y + 5, 2, 1, C.ink);
    rect(ctx, x + 4, y + 4, 2, 1, C.ink);
    return;
  }
  if (kind === "sad") {
    rect(ctx, x, y + 4, 4, 1, C.ink);
    rect(ctx, x + 1, y + 5, 2, 1, C.ink);
    rect(ctx, x + 2, y + 3, 2, 1, C.ink);
    return;
  }
  if (kind === "focus") {
    rect(ctx, x, y + 3, 6, 3, C.ink);
    rect(ctx, x + 1 + lookX, y + 3, 2, 1, C.creamLight);
    rect(ctx, x + 1, y + 1, 5, 1, C.inkSoft);
    return;
  }
  if (kind === "wide") {
    circle(ctx, x + 3, y + 3, 4, C.ink);
    rect(ctx, x + 2, y + 1, 2, 2, C.white);
    rect(ctx, x + 5, y + 4, 1, 1, C.white);
    return;
  }
  // default: open, with a gaze shift and a readable highlight
  const ex = x + lookX;
  const ey = y + lookY;
  rect(ctx, ex + 1, ey, 4, 1, C.ink);
  rect(ctx, ex, ey + 1, 6, 4, C.ink);
  rect(ctx, ex + 1, ey + 5, 4, 1, C.ink);
  rect(ctx, ex + 1, ey + 1, 2, 2, C.creamLight);
  rect(ctx, ex + 1, ey + 4, 1, 1, C.inkSoft);
  if (kind === "sparkle") {
    rect(ctx, ex + 3, ey + 2, 2, 2, C.white);
    rect(ctx, ex + 4, ey + 1, 1, 1, C.white);
  }
}

function drawFace(ctx, palette, hx, hy, expression) {
  const y = hy;
  const lookX = expression.lookX || 0;
  const lookY = expression.lookY || 0;
  const kind = expression.eyes || "open";
  const eyeY = 22 + y;
  drawEye(ctx, 22 + hx, eyeY, kind, lookX, lookY);
  drawEye(ctx, 37 + hx, eyeY, kind, lookX, lookY);

  // brows: barely there, but they sell focus and worry
  if (kind === "focus") {
    rect(ctx, 21 + hx, 19 + y, 6, 1, C.inkSoft);
    rect(ctx, 38 + hx, 19 + y, 6, 1, C.inkSoft);
    rect(ctx, 21 + hx, 20 + y, 2, 1, C.inkSoft);
    rect(ctx, 42 + hx, 20 + y, 2, 1, C.inkSoft);
  }
  if (kind === "sad") {
    rect(ctx, 21 + hx, 18 + y, 5, 1, C.inkSoft);
    rect(ctx, 39 + hx, 18 + y, 5, 1, C.inkSoft);
  }

  // blush
  rect(ctx, 17 + hx, 29 + y, 3, 1, C.blush);
  rect(ctx, 44 + hx, 29 + y, 3, 1, C.blush);

  // nose + mouth
  rect(ctx, 31 + hx, 29 + y, 3, 1, C.pinkDark);
  rect(ctx, 32 + hx, 30 + y, 1, 1, C.pink);
  const mouth = expression.mouth || "w";
  if (mouth === "open") {
    rr(ctx, 29 + hx, 31 + y, 7, 4, 2, C.ink);
    rect(ctx, 31 + hx, 33 + y, 3, 1, C.tongue);
  } else if (mouth === "small") {
    rect(ctx, 31 + hx, 32 + y, 3, 1, C.inkSoft);
  } else if (mouth === "sad") {
    rect(ctx, 30 + hx, 33 + y, 2, 1, C.inkSoft);
    rect(ctx, 32 + hx, 32 + y, 1, 1, C.inkSoft);
    rect(ctx, 33 + hx, 33 + y, 2, 1, C.inkSoft);
  } else if (mouth === "chew") {
    rect(ctx, 31 + hx, 32 + y, 3, 2, C.ink);
    rect(ctx, 32 + hx, 33 + y, 1, 1, C.tongue);
  } else if (mouth === "sleep") {
    rect(ctx, 31 + hx, 32 + y, 2, 1, C.inkSoft);
  } else {
    rect(ctx, 32 + hx, 31 + y, 1, 1, C.inkSoft);
    rect(ctx, 30 + hx, 32 + y, 2, 1, C.inkSoft);
    rect(ctx, 33 + hx, 32 + y, 2, 1, C.inkSoft);
  }

  // whiskers
  rect(ctx, 5 + hx, 27 + y, 11, 1, "rgba(92, 72, 52, 0.45)");
  rect(ctx, 8 + hx, 30 + y, 8, 1, "rgba(92, 72, 52, 0.35)");
  rect(ctx, 48 + hx, 27 + y, 11, 1, "rgba(92, 72, 52, 0.45)");
  rect(ctx, 48 + hx, 30 + y, 8, 1, "rgba(92, 72, 52, 0.35)");

  if (expression.tear) {
    rect(ctx, 43 + hx, 28 + y, 2, 2, C.tear);
    rect(ctx, 43 + hx, 30 + y, 1, 2, C.tear);
  }
}

function drawScarf(ctx, palette, bob, sway) {
  // band
  shell(ctx, 18, 36 + bob, 28, 7, 2, palette.scarf);
  rect(ctx, 21, 38 + bob, 20, 2, palette.scarfLight);
  rect(ctx, 21, 40 + bob, 12, 1, "rgba(0,0,0,0.12)");
  // knot
  shell(ctx, 39, 40 + bob, 8, 7, 2, palette.scarf);
  rect(ctx, 41, 42 + bob, 3, 2, palette.scarfLight);
  // loose end
  const x = 43 + sway;
  shell(ctx, x, 45 + bob, 7, 11, 2, palette.scarf);
  rect(ctx, x + 2, 47 + bob, 2, 7, palette.scarfLight);
  rect(ctx, x, 55 + bob, 3, 1, C.ink);
  rect(ctx, x + 4, 55 + bob, 3, 1, C.ink);
}

function drawPaw(ctx, x, y, raised = false) {
  shell(ctx, x, y, 8, 6, 2, C.cream, C.ink, 1);
  rect(ctx, x + 2, y + 2, 1, 1, C.creamShade);
  rect(ctx, x + 5, y + 2, 1, 1, C.creamShade);
  if (raised) {
    rect(ctx, x + 1, y - 1, 2, 1, C.ink);
    rect(ctx, x + 5, y - 1, 2, 1, C.ink);
  }
}

function drawArmBack(ctx, wave = 0) {
  // The arm is drawn before the head so it emerges from behind the cheek
  // instead of painting a cream stripe across the face.
  thickLine(ctx, [[43, 47], [50, 42], [56, 35], [58, 29 + wave]], C.ink, 6);
  thickLine(ctx, [[43, 47], [50, 42], [56, 35], [58, 29 + wave]], C.cream, 4);
}

function drawRaisedPaw(ctx, wave = 0, withMotion = false) {
  const pawX = 54;
  const pawY = 20 + wave;
  // wrist joins the paw to the hidden arm
  shell(ctx, pawX + 2, pawY + 5, 4, 4, 1, C.cream, C.ink, 1);
  drawPaw(ctx, pawX, pawY, true);
  if (withMotion) {
    rect(ctx, pawX - 4, pawY + 1, 1, 4, C.inkSoft);
    rect(ctx, pawX - 6, pawY + 5, 1, 2, C.inkSoft);
    rect(ctx, pawX + 9, pawY + 1, 1, 3, C.inkSoft);
  }
}

function drawTerminal(ctx, t, bob) {
  const x = 45;
  const y = 41 + bob;
  shell(ctx, x, y, 18, 13, 2, C.screen);
  rect(ctx, x + 2, y + 2, 14, 2, "#1e3a32");
  rect(ctx, x + 3, y + 2, 1, 1, "#e27b5e");
  rect(ctx, x + 5, y + 2, 1, 1, "#e6c65c");
  rect(ctx, x + 7, y + 2, 1, 1, C.mint);
  const lines = [
    [x + 3, 6, 9, C.mint],
    [x + 3, 8, 5, "#6f9e8e"],
    [x + 3, 10, 11, "#6f9e8e"],
  ];
  for (const [lx, ly, lw, color] of lines) {
    rect(ctx, lx, y + ly, lw, 1, color);
  }
  if (Math.floor(t / 500) % 2 === 0) rect(ctx, x + 3, y + 10, 3, 1, C.creamLight);
  // a tiny antenna nub
  rect(ctx, x + 15, y - 2, 1, 2, C.inkSoft);
}

function drawMagnifier(ctx, t, bob) {
  const cx = 52;
  const cy = 27 + bob;
  circle(ctx, cx, cy, 8, C.ink);
  circle(ctx, cx, cy, 6, "#b8d9cb");
  circle(ctx, cx, cy, 4, "#d7ebe3");
  rect(ctx, cx - 4, cy - 3, 2, 2, C.white);
  rect(ctx, cx + 2, cy + 2, 2, 1, "#8ab8a9");
  thickLine(ctx, [[cx + 5, cy + 5], [cx + 8, cy + 9]], C.ink, 3);
  thickLine(ctx, [[cx + 5, cy + 5], [cx + 8, cy + 9]], "#71867c", 1);
  // a tiny magnified angle bracket
  rect(ctx, cx - 2, cy, 1, 3, "#477064");
  rect(ctx, cx - 1, cy - 1, 1, 1, "#477064");
  rect(ctx, cx - 1, cy + 3, 1, 1, "#477064");
  rect(ctx, cx + 1, cy + 1, 2, 1, "#477064");
}

function drawDonut(ctx, t, bite) {
  const cx = 32;
  const cy = 49;
  circle(ctx, cx, cy, 8, C.ink);
  circle(ctx, cx, cy, 6, "#d9a562");
  // icing
  for (let x = -6; x <= 6; x += 1) {
    const top = cy - 5 + Math.round(Math.abs(x) / 3);
    if (Math.abs(x) <= 6 - bite * 2) rect(ctx, cx + x, top, 1, 3, C.pink);
  }
  circle(ctx, cx, cy, 2, C.creamShade);
  rect(ctx, cx - 1, cy - 1, 2, 2, "#b98651");
  const sprinkles = [
    [-4, -3, "#f4df8b"],
    [2, -2, "#7bbfa2"],
    [-2, 1, "#fff3d4"],
    [4, 0, "#f4df8b"],
  ];
  for (const [dx, dy, color] of sprinkles) rect(ctx, cx + dx, cy + dy, 1, 1, color);
  // bite mark
  if (bite > 0) {
    rect(ctx, cx + 4, cy - 3, 3, 3, "rgba(0,0,0,0)");
    rect(ctx, cx + 4, cy - 2, 2, 2, C.creamShade);
  }
}

function drawZzz(ctx, t, bob) {
  const float = Math.round((Math.sin(t / 650) + 1) * 1.5);
  const bigY = 1 + bob - float;
  const smallY = 8 + bob - float;
  // The pale offset is a halo so the glyphs read on dark and light desktops.
  zGlyph(ctx, 50, bigY + 1, C.creamLight, 1);
  zGlyph(ctx, 50, bigY, C.inkSoft, 1);
  zGlyph(ctx, 56, smallY + 1, C.creamLight, 1);
  zGlyph(ctx, 56, smallY, C.inkSoft, 1);
}

function drawFxGlyphs(ctx, name, t, bob) {
  if (name === "waiting") {
    const float = Math.round(Math.sin(t / 400));
    question(ctx, 56, 2 + bob + float + 1, C.creamLight);
    question(ctx, 55, 1 + bob + float, C.ink);
    sparkle(ctx, 49, 5 + bob + float, C.pink);
    sparkle(ctx, 59, 12 + bob + float, C.mint);
  }
  if (name === "failed") {
    bang(ctx, 8, 3 + bob + 1, C.creamLight);
    bang(ctx, 7, 2 + bob, C.danger);
    rect(ctx, 45, 15 + bob, 1, 3, C.tear);
  }
  if (name === "sleeping") drawZzz(ctx, t, bob);
}

export class PetEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.ctx.imageSmoothingEnabled = false;
    this.canvas.width = W;
    this.canvas.height = H;
    this.palette = PALETTES[options.palette] || PALETTES.miso;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.state = "idle";
    this.stateStarted = performance.now();
    this.stateDuration = 0;
    this.pointer = null;
    this.particles = [];
    this.nextBlink = performance.now() + 2600;
    this.blinkUntil = 0;
    this.nextTwitch = performance.now() + 6000;
    this.twitchUntil = 0;
    this.running = false;
    this.last = 0;
    this.onFrame = null;
    this._loop = this._loop.bind(this);
  }

  setPalette(name) {
    this.palette = PALETTES[name] || PALETTES.miso;
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  setState(name, duration = 0) {
    if (this.state === name || !STATE_COPY[name]) {
      if (duration) this.stateDuration = duration;
      return;
    }
    this.state = name;
    this.stateStarted = performance.now();
    this.stateDuration = duration;
    if (name === "happy") this.spawnHearts(3);
    if (name === "eating") this.spawnCrumbs(3);
    if (name === "failed") this.spawnSweat(1);
    if (name === "waving") this.spawnHearts(2);
  }

  setPointer(point) {
    this.pointer = point;
  }

  trigger(kind) {
    if (kind === "hearts") this.spawnHearts(5);
    if (kind === "crumbs") this.spawnCrumbs(5);
    if (kind === "sparkles") this.spawnSparkles(4);
    if (kind === "zzz") this.spawnZ(1);
  }

  spawnHearts(count) {
    for (let i = 0; i < count; i += 1) {
      const left = i % 2 === 0;
      this.particles.push({
        type: "heart",
        // Keep the face readable: hearts float up the outer edges instead of
        // covering the eyes.
        x: left ? 5 + Math.random() * 8 : 51 + Math.random() * 8,
        y: 18 + Math.random() * 18,
        vx: left ? -2 - Math.random() * 2 : 2 + Math.random() * 2,
        vy: -6 - Math.random() * 6,
        life: 1100 + Math.random() * 500,
        maxLife: 1600,
        color: Math.random() > 0.3 ? C.pink : this.palette.accent,
      });
    }
  }

  spawnCrumbs(count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        type: "crumb",
        x: 26 + Math.random() * 12,
        y: 48 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 16,
        vy: -8 - Math.random() * 6,
        life: 600 + Math.random() * 300,
        maxLife: 900,
        color: "#c58c52",
      });
    }
  }

  spawnSparkles(count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        type: "spark",
        x: 15 + Math.random() * 34,
        y: 15 + Math.random() * 18,
        vx: (Math.random() - 0.5) * 5,
        vy: -4 - Math.random() * 4,
        life: 700 + Math.random() * 400,
        maxLife: 1100,
        color: Math.random() > 0.5 ? C.mint : "#f1d27a",
      });
    }
  }

  spawnSweat(count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        type: "crumb",
        x: 46,
        y: 25,
        vx: 8,
        vy: 2,
        life: 700,
        maxLife: 700,
        color: C.tear,
      });
    }
  }

  spawnZ() {
    this.particles.push({
      type: "z",
      x: 46,
      y: 18,
      vx: 2,
      vy: -3,
      life: 1800,
      maxLife: 1800,
      color: C.inkSoft,
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  _loop(now) {
    if (!this.running) return;
    // Pixel art does not need 120fps. 30 is plenty and keeps the CPU cool.
    if (now - this.last >= 33) {
      this.draw(now);
      this.last = now;
    }
    requestAnimationFrame(this._loop);
  }

  _expression(now, pose) {
    const elapsed = now - this.stateStarted;
    const blinkActive = now < this.blinkUntil;
    if (this.state === "sleeping") return { eyes: "closed", mouth: "sleep" };
    if (this.state === "happy") return { eyes: "happy", mouth: "open", lookX: 0 };
    if (this.state === "waving") return { eyes: "happy", mouth: "open", lookX: 0 };
    if (this.state === "jumping") return { eyes: "happy", mouth: "open", lookX: 0, lookY: -1 };
    if (this.state === "failed") return { eyes: "sad", mouth: "sad", tear: true };
    if (this.state === "eating") return { eyes: "happy", mouth: Math.floor(elapsed / 150) % 2 ? "chew" : "open" };
    if (this.state === "working") return { eyes: "focus", mouth: "small", lookX: 1, lookY: 0 };
    if (this.state === "review") return { eyes: "focus", mouth: "w", lookX: 1, lookY: 0 };
    if (this.state === "waiting") return { eyes: "sparkle", mouth: "small", lookY: -1 };
    if (this.state === "dragged") return { eyes: "wide", mouth: "open", lookX: 0 };
    if (blinkActive) return { eyes: "blink", mouth: "w" };
    return { eyes: "open", mouth: "w", lookX: pose.lookX, lookY: pose.lookY };
  }

  draw(now = performance.now()) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const elapsed = now - this.stateStarted;
    const state = this.state;
    const ease = this.reducedMotion ? 0 : 1;

    if (now > this.nextBlink && state !== "sleeping" && state !== "working") {
      this.blinkUntil = now + 120;
      this.nextBlink = now + 2600 + Math.random() * 3000;
    }
    if (now > this.nextTwitch) {
      this.twitchUntil = now + 260;
      this.nextTwitch = now + 5000 + Math.random() * 5000;
    }

    // Cursor tracking: the pupils only move one crisp pixel, like a sprite would.
    let lookX = 0;
    let lookY = 0;
    if (this.pointer) {
      const dx = this.pointer.x - 32;
      const dy = this.pointer.y - 28;
      lookX = dx > 8 ? 1 : dx < -8 ? -1 : 0;
      lookY = dy > 13 ? 1 : dy < -15 ? -1 : 0;
    }

    const breathe = ease && Math.sin(now / 760) > 0.25 ? -1 : 0;
    let bob = state === "idle" || state === "waiting" ? breathe : 0;
    let headX = 0;
    let headY = bob;
    let bodyBob = bob;
    let tailPhase = ease ? Math.floor(now / 280) % 4 : 0;
    let twitch = now < this.twitchUntil ? 1 : 0;
    let droop = 0;
    let jumpOffset = 0;
    let squash = 1;
    let pose = { lookX, lookY };
    let sx = 0;
    let scarfSway = 0;

    if (state === "working") {
      headY = 1;
      bodyBob = 0;
      tailPhase = Math.floor(now / 520) % 4;
    } else if (state === "review") {
      headY = 0;
      tailPhase = 1;
    } else if (state === "waiting") {
      headY = -1 + breathe;
      tailPhase = 0;
    } else if (state === "failed") {
      headY = 2;
      bodyBob = 1;
      headX = -1;
      droop = 3;
      tailPhase = 3;
    } else if (state === "waving") {
      headY = -1;
      bodyBob = 0;
      tailPhase = 2;
      scarfSway = Math.floor(now / 180) % 2 ? 1 : 0;
    } else if (state === "jumping") {
      const progress = Math.min(1, elapsed / Math.max(1, this.stateDuration || 1200));
      // The canvas has four pixels of headroom above the ears.
      jumpOffset = -Math.round(Math.sin(progress * Math.PI) * 4 * ease);
      squash = 1 - Math.sin(progress * Math.PI) * 0.28 * ease;
      headY = -1;
      tailPhase = 1;
    } else if (state === "sleeping") {
      headY = 3 + (ease && Math.sin(now / 1100) > 0.2 ? -1 : 0);
      bodyBob = 1;
      headX = -1;
      tailPhase = 3;
    } else if (state === "happy") {
      const bounce = ease ? Math.round(Math.abs(Math.sin(elapsed / 160)) * -2) : 0;
      headY = bounce - 1;
      bodyBob = bounce;
      tailPhase = 2;
      scarfSway = 1;
    } else if (state === "eating") {
      headY = 1;
      bodyBob = 0;
      tailPhase = 0;
    } else if (state === "dragged") {
      headY = -1;
      bodyBob = -2;
      tailPhase = 1;
      pose = { lookX: 0, lookY: -1 };
      scarfSway = Math.floor(now / 130) % 2 ? 2 : 0;
    }

    const expression = this._expression(now, pose);
    const drawY = jumpOffset;
    const GROUND = 4;
    const raisedWave = state === "waving" && ease ? -(Math.floor(now / 180) % 2) : 0;

    drawShadow(ctx, squash, GROUND, C.shadow);
    ctx.save();
    ctx.translate(0, GROUND + drawY);

    drawTail(ctx, this.palette, tailPhase, {
      tailUp: state === "dragged",
      tailStraight: state === "failed",
    });
    drawBody(ctx, this.palette, bodyBob, breathe < 0);
    if (state === "waiting" || state === "waving") drawArmBack(ctx, raisedWave);
    drawHead(ctx, this.palette, headX, headY, twitch, droop);
    drawFace(ctx, this.palette, headX, headY, expression);

    // tiny lash/eyebrow accents outside the face pass
    if (expression.eyes === "open") {
      rect(ctx, 22 + headX + expression.lookX, 20 + headY, 2, 1, C.inkSoft);
      rect(ctx, 39 + headX + expression.lookX, 20 + headY, 2, 1, C.inkSoft);
    }

    drawScarf(ctx, this.palette, bodyBob, scarfSway);
    drawPaw(ctx, 23, 52 + bodyBob);
    drawPaw(ctx, 34, 52 + bodyBob);

    if (state === "working") {
      const tap = ease ? Math.floor(now / 140) % 2 : 0;
      drawPaw(ctx, 22, 50 + bodyBob + tap);
      drawPaw(ctx, 35, 50 + bodyBob + (1 - tap) * ease);
      drawTerminal(ctx, now, ease ? Math.round(Math.sin(now / 500)) : 0);
      sparkle(ctx, 42, 40, C.mint);
    }
    if (state === "review") {
      drawMagnifier(ctx, now, Math.round(Math.sin(now / 700)));
    }
    if (state === "waiting") {
      drawRaisedPaw(ctx, 0, false);
      rect(ctx, 38, 37, 1, 2, C.inkSoft);
    }
    if (state === "waving") {
      drawRaisedPaw(ctx, raisedWave, true);
      sparkle(ctx, 60, 23 + raisedWave, C.mint);
      sparkle(ctx, 46, 22, "#f1d27a");
      sparkle(ctx, 49, 26, C.pink);
    }
    if (state === "dragged") {
      drawPaw(ctx, 21, 48 + (Math.floor(now / 120) % 2), true);
      drawPaw(ctx, 35, 47 + (Math.floor(now / 150) % 2), true);
      thickLine(ctx, [[17, 38], [12, 35]], C.inkSoft, 1);
      thickLine(ctx, [[47, 38], [53, 34]], C.inkSoft, 1);
    }
    if (state === "eating") {
      const total = Math.max(1, this.stateDuration || 1800);
      const bite = Math.min(2, Math.floor((elapsed / total) * 3));
      drawDonut(ctx, now, bite);
      drawPaw(ctx, 25, 48 + bodyBob, true);
      drawPaw(ctx, 32, 48 + bodyBob, true);
    }

    drawFxGlyphs(ctx, state, now, headY);

    // particles
    for (const p of this.particles) {
      p.x += p.vx / 30;
      p.y += p.vy / 30;
      p.vy += 0.18;
      p.life -= 33;
      if (p.life <= 0) continue;
      const fade = p.type === "spark" && p.life < 250 ? 0.4 : 1;
      ctx.globalAlpha = fade;
      if (p.type === "heart") heart(ctx, Math.round(p.x), Math.round(p.y), p.color);
      if (p.type === "crumb") rect(ctx, Math.round(p.x), Math.round(p.y), 1, 1, p.color);
      if (p.type === "spark") sparkle(ctx, Math.round(p.x), Math.round(p.y), p.color);
      if (p.type === "z") zGlyph(ctx, Math.round(p.x), Math.round(p.y), p.color, 1);
      ctx.globalAlpha = 1;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y > -8);

    ctx.restore();
    this.onFrame?.(now);
  }
}

export { W as PET_CANVAS_WIDTH, H as PET_CANVAS_HEIGHT };
