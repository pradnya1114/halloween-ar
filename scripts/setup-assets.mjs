#!/usr/bin/env node
/**
 * One-shot offline setup. Runs automatically after `npm install` (postinstall)
 * and before `npm run dev` / `npm run build`.
 *
 *  1. Copies MediaPipe WASM runtime  -> public/mediapipe/wasm/
 *  2. Downloads pose + face models   -> public/models/   (skipped if present)
 *  3. Builds transparent mask/ghost PNGs from scripts/raw/*.jpg
 *                                     -> src/assets/{masks,ghosts}/ and public/{masks,ghosts}/
 *
 * Pure Node — no Python, no Pillow. Safe to re-run; only missing files are created.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => join(ROOT, ...p);
const log = (m) => console.log(`[setup-assets] ${m}`);
const ensureDir = (d) => mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ */
/* 1. WASM                                                              */
/* ------------------------------------------------------------------ */
function syncWasm() {
  const src = P("node_modules/@mediapipe/tasks-vision/wasm");
  const dst = P("public/mediapipe/wasm");
  ensureDir(dst);
  const files = [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
  ];
  let copied = 0;
  for (const f of files) {
    const s = join(src, f);
    const d = join(dst, f);
    if (!existsSync(s)) {
      log(`WARN missing ${s} — run npm install first`);
      continue;
    }
    if (!existsSync(d) || statSync(d).size !== statSync(s).size) {
      copyFileSync(s, d);
      copied++;
    }
  }
  log(`WASM runtime ok (${copied} copied)`);
}

/* ------------------------------------------------------------------ */
/* 2. Models                                                            */
/* ------------------------------------------------------------------ */
const MODELS = {
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  "pose_landmarker_full.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
};

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function syncModels() {
  const dir = P("public/models");
  ensureDir(dir);
  for (const [name, url] of Object.entries(MODELS)) {
    const dest = join(dir, name);
    if (existsSync(dest) && statSync(dest).size > 500_000) continue;
    try {
      log(`downloading ${name} …`);
      await download(url, dest);
      log(`  ✓ ${name} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      log(`  ✗ ${name}: ${e.message} — app will fall back to CDN at runtime`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Transparent PNGs from black-background JPGs                       */
/* ------------------------------------------------------------------ */
async function loadCodecs() {
  const [{ PNG }, jpeg] = await Promise.all([import("pngjs"), import("jpeg-js")]);
  return { PNG, jpeg: jpeg.default ?? jpeg };
}

/** luminance→alpha key, un-premultiply, feather edges. Mirrors make_transparent_ghosts.py */
function keyBlack(rgba, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i] / 255,
        g = rgba[i + 1] / 255,
        b = rgba[i + 2] / 255;
      const mx = Math.max(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = Math.max(mx, lum);
      let a = Math.min(1, Math.max(0, (v - 0.045) / 0.6));
      a = Math.pow(a, 0.8);
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      a *= Math.min(1, edge / 12);
      const safe = Math.max(a, 1e-4);
      const put = (c) => (a > 1e-3 ? Math.round(Math.min(1, c / safe) * 255) : 0);
      out[i] = put(r);
      out[i + 1] = put(g);
      out[i + 2] = put(b);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/** nearest-box downscale so long side ≤ max */
function downscale(rgba, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  if (k === 1) return { data: rgba, w, h };
  const nw = Math.round(w * k),
    nh = Math.round(h * k);
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy0 = Math.floor(y / k),
      sy1 = Math.min(h, Math.floor((y + 1) / k));
    for (let x = 0; x < nw; x++) {
      const sx0 = Math.floor(x / k),
        sx1 = Math.min(w, Math.floor((x + 1) / k));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let sy = sy0; sy < sy1; sy++)
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * w + sx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          n++;
        }
      const o = (y * nw + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, w: nw, h: nh };
}

const MASK_FILES = new Set(["horns", "wraith_skull"]);
const SKIP = new Set(["green_hair", "joker_cards"]); // joker was removed

async function buildPngs() {
  const rawDir = P("scripts/raw");
  if (!existsSync(rawDir)) return log("no scripts/raw — skipping PNG build");
  const { PNG, jpeg } = await loadCodecs();
  const outDirs = {
    mask: [P("src/assets/masks"), P("public/masks")],
    ghost: [P("src/assets/ghosts"), P("public/ghosts")],
  };
  Object.values(outDirs).flat().forEach(ensureDir);
  const { readdirSync } = await import("node:fs");
  let made = 0;
  for (const f of readdirSync(rawDir)) {
    if (!/\.(jpe?g)$/i.test(f)) continue;
    const stem = f.replace(/\.jpe?g$/i, "");
    if (SKIP.has(stem)) continue;
    const kind = MASK_FILES.has(stem) ? "mask" : "ghost";
    const targets = outDirs[kind].map((d) => join(d, `${stem}.png`));
    if (targets.every((t) => existsSync(t))) continue;
    const img = jpeg.decode(readFileSync(join(rawDir, f)), { useTArray: true, formatAsRGBA: true });
    const small = downscale(img.data, img.width, img.height, 640);
    const keyed = keyBlack(small.data, small.w, small.h);
    const png = new PNG({ width: small.w, height: small.h });
    png.data = keyed;
    const buf = PNG.sync.write(png);
    for (const t of targets) writeFileSync(t, buf);
    made++;
    log(`  ✓ ${stem}.png (${kind})`);
  }
  log(`PNG assets ok (${made} generated)`);
}

/* ------------------------------------------------------------------ */
await (async () => {
  log(`project: ${ROOT}`);
  syncWasm();
  await buildPngs();
  await syncModels();
  log("done");
})().catch((e) => {
  console.error("[setup-assets] failed:", e);
  process.exitCode = 0; // never block install/build
});
