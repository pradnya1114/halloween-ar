import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import hornsSrc from "../assets/masks/horns.png";
import skullSrc from "../assets/masks/wraith_skull.png";
import type { FaceFilter, Settings } from "../config/settings";
import { ZERO_EXPR, ZERO_HEAD, type FaceDetection, type FaceExpr, type HeadPose } from "../lib/faceTypes";
import { mapPoint, STAGE_W, type Vec, type ViewTransform } from "../lib/geometry";
import type { Track } from "../lib/tracker";

const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const L_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const R_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const UPPER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LOWER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];

export interface FaceRig {
  cx: number;
  cy: number;
  nose: Vec;
  lEye: Vec;
  rEye: Vec;
  lIris: Vec;
  rIris: Vec;
  mouthL: Vec;
  mouthR: Vec;
  mouthTop: Vec;
  mouthBot: Vec;
  chin: Vec;
  forehead: Vec;
  lTemple: Vec;
  rTemple: Vec;
  roll: number;
  width: number;
  height: number;
  oval: Vec[];
  lEyePoly: Vec[];
  rEyePoly: Vec[];
  upperLip: Vec[];
  lowerLip: Vec[];
  mouthOpen: number;
  /** blendshape-driven expressions (0..1) */
  expr: FaceExpr;
  /** head rotation (radians) */
  head: HeadPose;
}

function load(src: string) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  return img;
}

const avg = (...v: Vec[]) => ({ x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length });
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const copyV = (v: Vec): Vec => ({ x: v.x, y: v.y });
function lerpV(a: Vec, b: Vec, t: number): Vec {
  a.x += (b.x - a.x) * t;
  a.y += (b.y - a.y) * t;
  return a;
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function lerpPts(dst: Vec[], src: Vec[], t: number) {
  if (dst.length !== src.length) return src.map(copyV);
  for (let i = 0; i < dst.length; i++) lerpV(dst[i], src[i], t);
  return dst;
}
function cloneRig(r: FaceRig): FaceRig {
  return {
    ...r,
    nose: copyV(r.nose),
    lEye: copyV(r.lEye),
    rEye: copyV(r.rEye),
    lIris: copyV(r.lIris),
    rIris: copyV(r.rIris),
    mouthL: copyV(r.mouthL),
    mouthR: copyV(r.mouthR),
    mouthTop: copyV(r.mouthTop),
    mouthBot: copyV(r.mouthBot),
    chin: copyV(r.chin),
    forehead: copyV(r.forehead),
    lTemple: copyV(r.lTemple),
    rTemple: copyV(r.rTemple),
    oval: r.oval.map(copyV),
    lEyePoly: r.lEyePoly.map(copyV),
    rEyePoly: r.rEyePoly.map(copyV),
    upperLip: r.upperLip.map(copyV),
    lowerLip: r.lowerLip.map(copyV),
    expr: { ...r.expr },
    head: { ...r.head },
  };
}
function blendRig(s: FaceRig, raw: FaceRig, t: number, tSlow: number) {
  s.cx += (raw.cx - s.cx) * t;
  s.cy += (raw.cy - s.cy) * t;
  s.roll = lerpAngle(s.roll, raw.roll, tSlow);
  s.width += (raw.width - s.width) * tSlow;
  s.height += (raw.height - s.height) * tSlow;
  lerpV(s.nose, raw.nose, t);
  lerpV(s.lEye, raw.lEye, t);
  lerpV(s.rEye, raw.rEye, t);
  lerpV(s.lIris, raw.lIris, t);
  lerpV(s.rIris, raw.rIris, t);
  lerpV(s.mouthL, raw.mouthL, t);
  lerpV(s.mouthR, raw.mouthR, t);
  lerpV(s.mouthTop, raw.mouthTop, t);
  lerpV(s.mouthBot, raw.mouthBot, t);
  lerpV(s.chin, raw.chin, t);
  lerpV(s.forehead, raw.forehead, t);
  lerpV(s.lTemple, raw.lTemple, t);
  lerpV(s.rTemple, raw.rTemple, t);
  s.mouthOpen += (raw.mouthOpen - s.mouthOpen) * t;
  // blinks are fast — track them with a quicker response than position
  const tFast = Math.min(1, t * 2.2);
  for (const k of Object.keys(s.expr) as (keyof FaceExpr)[]) s.expr[k] += (raw.expr[k] - s.expr[k]) * tFast;
  s.head.yaw = lerpAngle(s.head.yaw, raw.head.yaw, tSlow);
  s.head.pitch = lerpAngle(s.head.pitch, raw.head.pitch, tSlow);
  s.head.roll = lerpAngle(s.head.roll, raw.head.roll, tSlow);
  s.lEyePoly = lerpPts(s.lEyePoly, raw.lEyePoly, t);
  s.rEyePoly = lerpPts(s.rEyePoly, raw.rEyePoly, t);
  s.upperLip = lerpPts(s.upperLip, raw.upperLip, t);
  s.lowerLip = lerpPts(s.lowerLip, raw.lowerLip, t);
  // follow the real mesh outline; only fall back to an ellipse when point counts differ
  s.oval = raw.oval.length && raw.oval.length === s.oval.length ? lerpPts(s.oval, raw.oval, t) : raw.oval.map(copyV);
  if (s.oval.length < 8) s.oval = ellipseOval(s.cx, s.cy, s.width * 0.5, s.height * 0.5, s.roll);
}

function ellipseOval(cx: number, cy: number, rx: number, ry: number, roll: number, n = 40): Vec[] {
  const pts: Vec[] = [];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push({ x: cx + x * cr - y * sr, y: cy + x * sr + y * cr });
  }
  return pts;
}

function inflate(pts: Vec[], c: Vec, s: number): Vec[] {
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * s, y: c.y + (p.y - c.y) * s }));
}

export function rigFromMesh(lms: NormalizedLandmark[], view: ViewTransform, expr: FaceExpr = ZERO_EXPR, head: HeadPose = ZERO_HEAD): FaceRig {
  const P = (i: number) => mapPoint(view, lms[Math.min(i, lms.length - 1)].x, lms[Math.min(i, lms.length - 1)].y);
  const a = P(33);
  const b = P(263);
  const [lEye, rEye] = a.x <= b.x ? [a, b] : [b, a];
  const ia = lms.length > 473 ? P(468) : lEye;
  const ib = lms.length > 473 ? P(473) : rEye;
  const [lIris, rIris] = ia.x <= ib.x ? [ia, ib] : [ib, ia];
  const mL0 = P(61);
  const mR0 = P(291);
  const [mouthL, mouthR] = mL0.x <= mR0.x ? [mL0, mR0] : [mR0, mL0];
  const nose = P(1);
  const forehead = P(10);
  const chin = P(152);
  const t0 = P(234);
  const t1 = P(454);
  const [lTemple, rTemple] = t0.x <= t1.x ? [t0, t1] : [t1, t0];
  const roll = Math.atan2(rEye.y - lEye.y, rEye.x - lEye.x);
  // true face size — temple-to-temple and hairline-to-chin, no padding
  const width = Math.max(dist(lTemple, rTemple), dist(lEye, rEye) * 2.0, 48);
  const height = Math.max(dist(chin, forehead), width * 1.15);
  const cx = (lTemple.x + rTemple.x) / 2;
  const cy = (forehead.y + chin.y) / 2;
  const mouthTop = P(13);
  const mouthBot = P(14);
  const mw = Math.max(dist(mouthL, mouthR), 1);
  // geometric estimate, boosted by the jawOpen blendshape when available
  const geo = Math.max(0, Math.min(1, (dist(mouthTop, mouthBot) / mw - 0.08) / 0.55));
  const mouthOpen = Math.max(geo, Math.min(1, expr.jawOpen * 1.6));
  const rawOval = OVAL.filter((i) => i < lms.length).map(P);
  return {
    cx,
    cy,
    nose,
    lEye,
    rEye,
    lIris,
    rIris,
    mouthL,
    mouthR,
    mouthTop,
    mouthBot,
    chin,
    forehead,
    lTemple,
    rTemple,
    roll,
    width,
    height,
    oval: inflate(rawOval.length > 8 ? rawOval : ellipseOval(cx, cy, width * 0.5, height * 0.5, roll), { x: cx, y: cy }, 1.02),
    lEyePoly: L_EYE.filter((i) => i < lms.length).map(P),
    rEyePoly: R_EYE.filter((i) => i < lms.length).map(P),
    upperLip: UPPER.filter((i) => i < lms.length).map(P),
    lowerLip: LOWER.filter((i) => i < lms.length).map(P),
    mouthOpen,
    expr,
    head,
  };
}

export function rigFromPose(lms: NormalizedLandmark[], view: ViewTransform): FaceRig | null {
  if (!lms || lms.length < 11) return null;
  const P = (i: number) => mapPoint(view, lms[i].x, lms[i].y);
  const nose = P(0);
  const eA = P(2);
  const eB = P(5);
  const [lEye, rEye] = eA.x <= eB.x ? [eA, eB] : [eB, eA];
  const earA = P(7);
  const earB = P(8);
  const [lTemple, rTemple] = earA.x <= earB.x ? [earA, earB] : [earB, earA];
  const mA = P(9);
  const mB = P(10);
  const [mouthL, mouthR] = mA.x <= mB.x ? [mA, mB] : [mB, mA];
  const mouth = avg(mouthL, mouthR);
  const roll = Math.atan2(rEye.y - lEye.y, rEye.x - lEye.x);
  const width = Math.max(dist(lTemple, rTemple), dist(lEye, rEye) * 2.0, 48);
  const upx = (nose.x - mouth.x) * 1.2;
  const upy = (nose.y - mouth.y) * 1.2;
  const forehead = { x: nose.x + upx * 0.9, y: nose.y + upy * 0.9 };
  const chin = { x: mouth.x - upx * 0.85, y: mouth.y - upy * 0.85 };
  const height = Math.max(dist(chin, forehead), width * 1.15);
  const cx = (lTemple.x + rTemple.x) / 2;
  const cy = (forehead.y + chin.y) / 2;
  const mouthTop = { x: mouth.x + upx * 0.15, y: mouth.y + upy * 0.15 };
  const mouthBot = { x: mouth.x - upx * 0.2, y: mouth.y - upy * 0.2 };
  const mouthOpen = Math.max(0, Math.min(1, (dist(mouthTop, mouthBot) / Math.max(dist(mouthL, mouthR), 1) - 0.12) / 0.5));
  return {
    cx,
    cy,
    nose,
    lEye,
    rEye,
    lIris: lEye,
    rIris: rEye,
    mouthL,
    mouthR,
    mouthTop,
    mouthBot,
    chin,
    forehead,
    lTemple,
    rTemple,
    roll,
    width,
    height,
    oval: ellipseOval(cx, cy, width * 0.5, height * 0.5, roll),
    lEyePoly: [],
    rEyePoly: [],
    upperLip: [mouthL, mouthTop, mouthR],
    lowerLip: [mouthL, mouthBot, mouthR],
    mouthOpen,
    expr: { ...ZERO_EXPR },
    head: { ...ZERO_HEAD, roll },
  };
}

export function collectRigs(faces: FaceDetection[], tracks: Track[], view: ViewTransform | null): FaceRig[] {
  if (!view) return [];
  const rigs: FaceRig[] = [];
  for (const f of faces) {
    if (f?.landmarks && f.landmarks.length >= 400) rigs.push(rigFromMesh(f.landmarks, view, f.expr, f.head));
  }
  for (const t of tracks) {
    // only body-pose tracks (33 landmarks) need a fallback rig; face tracks already have one
    if (t.state !== "confirmed" || !t.raw || t.face || t.raw.length > 40) continue;
    const r = rigFromPose(t.raw, view);
    if (!r) continue;
    const dup = rigs.some((g) => dist(g.nose, r.nose) < Math.max(g.width, r.width) * 0.75);
    if (!dup) rigs.push(r);
  }
  return rigs;
}

/** Clip to the real face outline from the mesh (36-pt FACE_OVAL), not a padded ellipse. */
function clipOval(ctx: CanvasRenderingContext2D, r: FaceRig) {
  ctx.beginPath();
  if (r.oval.length >= 8) {
    ctx.moveTo(r.oval[0].x, r.oval[0].y);
    for (let i = 1; i < r.oval.length; i++) ctx.lineTo(r.oval[i].x, r.oval[i].y);
    ctx.closePath();
  } else {
    ctx.ellipse(r.cx, r.cy, r.width * 0.5, r.height * 0.5, r.roll, 0, Math.PI * 2);
  }
}

function drawMappedVideo(ctx: CanvasRenderingContext2D, r: FaceRig, view: ViewTransform, frame: HTMLCanvasElement, filter: string) {
  ctx.save();
  clipOval(ctx, r);
  ctx.clip();
  ctx.filter = filter;
  ctx.save();
  if (view.mirror) ctx.setTransform(-1, 0, 0, 1, STAGE_W, 0);
  ctx.drawImage(frame, view.ox, view.oy, view.rw * view.s, view.rh * view.s);
  ctx.restore();
  ctx.filter = "none";
  ctx.restore();
}

function poly(ctx: CanvasRenderingContext2D, pts: Vec[]) {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** Darken the real lip gap only — never a giant black circle. */
function fillMouthCavity(ctx: CanvasRenderingContext2D, r: FaceRig, color: string) {
  if (r.mouthOpen < 0.22) return;
  if (r.upperLip.length < 8 || r.lowerLip.length < 8) return;
  ctx.fillStyle = color;
  poly(ctx, [...r.upperLip, ...[...r.lowerLip].reverse()]);
  ctx.fill();
}

function eyeBall(ctx: CanvasRenderingContext2D, c: Vec, rx: number, ry: number, roll: number, sclera: string, iris: string, pupil: string) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(roll);
  ctx.fillStyle = sclera;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.55, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pupil;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.22, ry * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.beginPath();
  ctx.arc(-rx * 0.22, -ry * 0.28, rx * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Half-width / half-height of the actual eye opening from the mesh polygon. */
function eyeSize(r: FaceRig, poly: Vec[]): { rx: number; ry: number } {
  if (poly.length >= 8) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of poly) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    const rx = Math.max(6, (x1 - x0) * 0.5);
    // real eye height varies with blink; use a stable proportion of width for the ball
    return { rx, ry: Math.max(5, rx * 0.62) };
  }
  // anatomical fallback: eye ≈ 1/5 of face width
  const rx = r.width * 0.1;
  return { rx, ry: rx * 0.62 };
}

/**
 * Eyelid that closes over an eyeBall as `blink` → 1. Drawn in the mask's
 * skin colour so a shut eye looks like real skin, not a hole.
 */
function drawEyelid(ctx: CanvasRenderingContext2D, c: Vec, rx: number, ry: number, roll: number, blink: number, skin: string) {
  if (blink < 0.08) return;
  const cover = Math.min(1, blink * 1.15);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(roll);
  ctx.fillStyle = skin;
  // upper lid sweeps down
  ctx.beginPath();
  ctx.ellipse(0, -ry * (1 - cover) * 0.9, rx * 1.25, ry * 1.25, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(rx * 1.25, -ry * (1 - cover) * 0.9 + ry * 1.25 * cover);
  ctx.lineTo(-rx * 1.25, -ry * (1 - cover) * 0.9 + ry * 1.25 * cover);
  ctx.closePath();
  ctx.fill();
  if (cover > 0.85) {
    // lash line when fully shut
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = Math.max(1.5, rx * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-rx * 1.05, ry * 0.05);
    ctx.quadraticCurveTo(0, ry * 0.45, rx * 1.05, ry * 0.05);
    ctx.stroke();
  }
  ctx.restore();
}

/** Blink amounts — honour the setting, and swap L/R when the video is mirrored. */
function blinks(r: FaceRig, s: Settings, view: ViewTransform | null): [number, number] {
  if (!s.exprBlink) return [0, 0];
  // r.lEye is SCREEN-left. MediaPipe's eyeBlinkLeft is the SUBJECT's left eye.
  // In an un-mirrored feed the subject's left eye is on screen-right.
  const mirrored = !!view?.mirror;
  const subjL = r.expr.blinkL;
  const subjR = r.expr.blinkR;
  return mirrored ? [subjL, subjR] : [subjR, subjL];
}

/** Horizontal/vertical parallax offset for things that sit on the head (horns). */
function headOffset(r: FaceRig, s: Settings): Vec {
  if (!s.exprHead) return { x: 0, y: 0 };
  return { x: Math.sin(r.head.yaw) * r.width * 0.35, y: Math.sin(r.head.pitch) * r.height * 0.18 };
}

function drawHornFire(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 8; i++) {
    const ph = t * 0.018 + i * 1.3;
    const flicker = Math.sin(ph) * size * 0.14;
    const h = size * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph * 1.4)));
    const w = size * (0.28 - i * 0.022);
    ctx.fillStyle = i < 2 ? "rgba(255,255,200,0.95)" : i < 4 ? "rgba(255,170,40,0.8)" : "rgba(255,40,0,0.45)";
    ctx.beginPath();
    ctx.moveTo(x + flicker, y - h);
    ctx.quadraticCurveTo(x + w + flicker * 0.5, y - h * 0.35, x, y + size * 0.05);
    ctx.quadraticCurveTo(x - w + flicker * 0.5, y - h * 0.35, x + flicker, y - h);
    ctx.fill();
  }
  ctx.restore();
}

function drawFangs(ctx: CanvasRenderingContext2D, r: FaceRig) {
  const o = Math.max(0, (r.mouthOpen - 0.1) / 0.45);
  if (o < 0.04) return;
  const len = r.height * (0.04 + 0.16 * Math.min(1, o));
  const w = r.width * 0.032;
  const ys = r.mouthTop.y + r.height * 0.01;
  const xs = [r.mouthL.x * 0.55 + r.mouthTop.x * 0.45, r.mouthR.x * 0.55 + r.mouthTop.x * 0.45];
  ctx.fillStyle = "#f7f2e8";
  ctx.strokeStyle = "rgba(40,20,20,0.45)";
  ctx.lineWidth = 1.2;
  for (const x of xs) {
    ctx.beginPath();
    ctx.moveTo(x - w, ys);
    ctx.lineTo(x + w, ys);
    ctx.lineTo(x, ys + len);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawWebs(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(210, 28, 22, 0.82)";
  ctx.lineWidth = 2.2;
  const corners: [number, number, number][] = [
    [0, 0, 1],
    [STAGE_W, 0, -1],
  ];
  for (const [ox, oy, dir] of corners) {
    for (let i = 0; i < 8; i++) {
      const a = (0.08 + i * 0.09) * Math.PI * dir;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a) * 520, oy + Math.sin(Math.abs(a)) * 420);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let r = 70; r < 380; r += 55) {
      const start = dir > 0 ? 0 : Math.PI * 0.55;
      const end = dir > 0 ? Math.PI * 0.55 : Math.PI;
      ctx.arc(ox, oy, r, start, end, dir < 0);
    }
    ctx.stroke();
  }
  // hanging thread + spider
  ctx.beginPath();
  ctx.moveTo(STAGE_W * 0.78, 0);
  ctx.lineTo(STAGE_W * 0.78, 210);
  ctx.stroke();
  ctx.fillStyle = "rgba(190, 24, 18, 0.95)";
  ctx.beginPath();
  ctx.ellipse(STAGE_W * 0.78, 222, 9, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(160, 20, 16, 0.95)";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(STAGE_W * 0.78, 222);
    ctx.quadraticCurveTo(STAGE_W * 0.78 + Math.cos(a) * 18, 222 + Math.sin(a) * 10, STAGE_W * 0.78 + Math.cos(a) * 28, 222 + Math.sin(a) * 22);
    ctx.stroke();
  }
  ctx.restore();
}

type MakeupFilter = Exclude<FaceFilter, "none" | "random">;

interface FaceSlot {
  cx: number;
  cy: number;
  last: number;
  appeared: number;
  randomFilter: MakeupFilter;
  randomChangedAt: number;
  s: FaceRig;
}

const MAKEUP_FILTERS: MakeupFilter[] = ["skull", "wraith", "devil", "vampire"];

function randomMakeup(previous?: MakeupFilter): MakeupFilter {
  const choices = previous ? MAKEUP_FILTERS.filter((filter) => filter !== previous) : MAKEUP_FILTERS;
  return choices[Math.floor(Math.random() * choices.length)];
}

export class FaceMaskRenderer {
  private horns = load(hornsSrc);
  private skull = load(skullSrc);
  private slots: FaceSlot[] = [];

  draw(ctx: CanvasRenderingContext2D, rigs: FaceRig[], s: Settings, view: ViewTransform | null, frame: HTMLCanvasElement | null, now = performance.now()) {
    if (s.faceFilter === "none" || s.faceMaskStrength <= 0.01) return;
    const k = s.faceMaskStrength;
    const delay = Math.max(0, s.maskDelaySec) * 1000;
    const used = new Set<FaceSlot>();
    if (s.faceFilter === "vampire" && rigs.length) drawWebs(ctx);
    // Match each detected face to its own slot (nearest first, never shared)
    const pairs: { raw: FaceRig; sl: FaceSlot; d: number }[] = [];
    for (const raw of rigs) {
      for (const sl of this.slots) {
        const d = dist({ x: sl.cx, y: sl.cy }, { x: raw.cx, y: raw.cy });
        if (d < Math.min(raw.width, sl.s.width) * 0.6) pairs.push({ raw, sl, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const assigned = new Map<FaceRig, FaceSlot>();
    for (const p of pairs) {
      if (assigned.has(p.raw) || used.has(p.sl)) continue;
      assigned.set(p.raw, p.sl);
      used.add(p.sl);
    }
    for (const raw of rigs) {
      let best: FaceSlot | null = assigned.get(raw) ?? null;
      if (!best) {
        best = { cx: raw.cx, cy: raw.cy, last: now, appeared: now, randomFilter: randomMakeup(), randomChangedAt: now, s: cloneRig(raw) };
        this.slots.push(best);
        used.add(best);
      }
      const dt = Math.max(0.001, (now - best.last) / 1000);
      best.last = now;
      const a = 1 - Math.exp(-12 * dt);
      const aSlow = 1 - Math.exp(-7 * dt);
      blendRig(best.s, raw, a, aSlow);
      best.cx = best.s.cx;
      best.cy = best.s.cy;
      if (now - best.appeared < delay) continue;
      const r = best.s;
      ctx.save();
      if (s.halfFace) {
        ctx.translate(r.cx, r.cy);
        ctx.rotate(r.roll);
        ctx.beginPath();
        if (s.halfFaceSide === "left") ctx.rect(-r.width * 3, -r.height * 3, r.width * 3, r.height * 6);
        else ctx.rect(0, -r.height * 3, r.width * 3, r.height * 6);
        ctx.clip();
        ctx.rotate(-r.roll);
        ctx.translate(-r.cx, -r.cy);
      }
      let filter: MakeupFilter;
      if (s.faceFilter === "random") {
        if (now - best.randomChangedAt >= 12000) {
          best.randomFilter = randomMakeup(best.randomFilter);
          best.randomChangedAt = now;
        }
        filter = best.randomFilter;
      } else {
        filter = s.faceFilter as MakeupFilter;
      }
      switch (filter) {
        case "skull":
          this.skullMakeup(ctx, r, view, frame, k, s);
          break;
        case "wraith":
          this.wraith(ctx, r, view, frame, k, s);
          break;
        case "devil":
          this.devil(ctx, r, view, frame, k, s, now);
          break;
        case "vampire":
          this.vampire(ctx, r, view, frame, k, s);
          break;
      }
      ctx.restore();
    }
    this.slots = this.slots.filter((sl) => now - sl.last < 900);
  }

  private skullMakeup(ctx: CanvasRenderingContext2D, r: FaceRig, view: ViewTransform | null, frame: HTMLCanvasElement | null, k: number, s: Settings) {
    if (view && frame) drawMappedVideo(ctx, r, view, frame, "grayscale(1) contrast(1.55) brightness(0.62)");
    ctx.save();
    clipOval(ctx, r);
    ctx.clip();
    ctx.globalAlpha = 0.45 * k;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    clipOval(ctx, r);
    ctx.fill();
    ctx.globalAlpha = k;
    const { rx: erx, ry: ery } = eyeSize(r, r.lEyePoly);
    for (const eye of [r.lEye, r.rEye]) {
      const g = ctx.createRadialGradient(eye.x, eye.y, 0, eye.x, eye.y, erx * 1.9);
      g.addColorStop(0, "rgba(0,0,0,0.95)");
      g.addColorStop(0.55, "rgba(80,0,0,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(eye.x, eye.y, erx * 1.9, ery * 2.4, r.roll, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#050505";
    ctx.save();
    ctx.translate(r.nose.x, r.nose.y);
    ctx.rotate(r.roll);
    ctx.beginPath();
    ctx.moveTo(0, -r.height * 0.02);
    ctx.lineTo(-r.width * 0.09, r.height * 0.12);
    ctx.lineTo(r.width * 0.09, r.height * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = Math.max(3, r.width * 0.018);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r.mouthL.x, r.mouthL.y);
    ctx.quadraticCurveTo(r.mouthBot.x, r.mouthBot.y + r.height * 0.02, r.mouthR.x, r.mouthR.y);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, r.width * 0.01);
    ctx.strokeStyle = "rgba(90,0,0,0.85)";
    for (const eye of [r.lEye, r.rEye]) {
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y + r.height * 0.05);
      ctx.quadraticCurveTo(eye.x + r.width * 0.02, eye.y + r.height * 0.18, eye.x - r.width * 0.01, eye.y + r.height * 0.28);
      ctx.stroke();
    }
    ctx.restore();
    eyeBall(ctx, r.lIris, erx * 0.9, ery * 0.95, r.roll, "#1a0000", "#ff1400", "#2a0000");
    eyeBall(ctx, r.rIris, erx * 0.9, ery * 0.95, r.roll, "#e8e8e8", "#111", "#000");
    const [bl, br] = blinks(r, s, view);
    drawEyelid(ctx, r.lIris, erx * 0.95, ery, r.roll, bl, "#0a0a0a");
    drawEyelid(ctx, r.rIris, erx * 0.95, ery, r.roll, br, "#0a0a0a");
    // brows raised → skull "surprised": lift the drip lines; frown → deepen sockets
    if (s.exprMouth && r.expr.browDown > 0.35) {
      ctx.save();
      ctx.globalAlpha = k * Math.min(1, (r.expr.browDown - 0.35) * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      for (const e of [r.lEye, r.rEye]) {
        ctx.beginPath();
        ctx.ellipse(e.x, e.y - ery * 0.9, erx * 1.5, ery * 0.6, r.roll, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private wraith(ctx: CanvasRenderingContext2D, r: FaceRig, view: ViewTransform | null, frame: HTMLCanvasElement | null, k: number, s: Settings) {
    if (view && frame) drawMappedVideo(ctx, r, view, frame, "grayscale(0.55) contrast(1.35) brightness(0.38) hue-rotate(200deg)");
    ctx.save();
    clipOval(ctx, r);
    ctx.clip();
    ctx.globalAlpha = k;
    const img = this.skull;
    if (img.complete && img.naturalWidth > 8) {
      ctx.translate(r.cx, r.cy);
      ctx.rotate(r.roll);
      ctx.drawImage(img, -r.width * 0.78, -r.height * 0.82, r.width * 1.56, r.height * 1.62);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 0.35 * k;
    ctx.fillStyle = "rgba(10, 20, 40, 0.7)";
    clipOval(ctx, r);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = "#020308";
    const [bl, br] = blinks(r, s, view);
    const eyes: [Vec, number][] = [
      [r.lEye, bl],
      [r.rEye, br],
    ];
    const { rx: wrx, ry: wry } = eyeSize(r, r.lEyePoly);
    for (const [e, blink] of eyes) {
      ctx.fillStyle = "#020308";
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, wrx * 1.15, wry * 1.3, r.roll, 0, Math.PI * 2);
      ctx.fill();
      // the spectral glow dies when the eye shuts — blink = light goes out
      const glow = 1 - Math.min(1, blink * 1.3);
      if (glow > 0.02) {
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, wrx * 0.9);
        g.addColorStop(0, `rgba(80,200,255,${0.85 * glow})`);
        g.addColorStop(0.35, `rgba(40,120,255,${0.35 * glow})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, wrx * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // head turned → one side of the skull falls into shadow
    if (s.exprHead && Math.abs(r.head.yaw) > 0.12) {
      const side = Math.sign(r.head.yaw) * (view?.mirror ? -1 : 1);
      const amt = Math.min(1, (Math.abs(r.head.yaw) - 0.12) * 2.2);
      ctx.save();
      clipOval(ctx, r);
      ctx.clip();
      const g = ctx.createLinearGradient(r.cx - side * r.width * 0.6, 0, r.cx + side * r.width * 0.6, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.7 * amt * k})`);
      ctx.fillStyle = g;
      clipOval(ctx, r);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private devil(ctx: CanvasRenderingContext2D, r: FaceRig, view: ViewTransform | null, frame: HTMLCanvasElement | null, k: number, s: Settings, now: number) {
    if (view && frame) drawMappedVideo(ctx, r, view, frame, "saturate(1.45) contrast(1.2) brightness(0.72)");
    ctx.save();
    clipOval(ctx, r);
    ctx.clip();
    ctx.globalAlpha = 0.7 * k;
    ctx.fillStyle = "rgba(140,0,0,0.82)";
    clipOval(ctx, r);
    ctx.fill();
    ctx.globalAlpha = 0.5 * k;
    ctx.fillStyle = "rgba(20,0,0,0.55)";
    const { rx: erx, ry: ery } = eyeSize(r, r.lEyePoly);
    for (const e of [r.lEye, r.rEye]) {
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, erx * 1.7, ery * 2.0, r.roll, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // glance: slit pupils drift with head yaw so the devil "looks" where you turn
    const look = s.exprHead ? Math.sin(r.head.yaw) * erx * 0.35 * (view?.mirror ? -1 : 1) : 0;
    for (const e of [r.lIris, r.rIris]) {
      eyeBall(ctx, e, erx, ery, r.roll, "#ffee66", "#ff3300", "#1a0000");
      ctx.save();
      ctx.translate(e.x + look, e.y);
      ctx.rotate(r.roll);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(0, 0, erx * 0.13, ery * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const [bl, br] = blinks(r, s, view);
    drawEyelid(ctx, r.lIris, erx, ery, r.roll, bl, "#6a0000");
    drawEyelid(ctx, r.rIris, erx, ery, r.roll, br, "#6a0000");
    fillMouthCavity(ctx, r, "rgba(20,0,0,0.85)");
    if (this.horns.complete && this.horns.naturalWidth) {
      // horns sit on the skull, so they parallax with head rotation
      const off = headOffset(r, s);
      const ox = r.forehead.x + off.x;
      const oy = r.forehead.y + s.hornHeight * r.height + off.y;
      const hw = r.width * 2.35 * s.hornSize;
      const hh = r.width * 1.5 * s.hornSize;
      // perspective squash when turning: the far horn foreshortens
      const yawK = s.exprHead ? Math.cos(r.head.yaw) : 1;
      const tiltSkew = s.exprHead ? -Math.sin(r.head.pitch) * 0.25 : 0;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate(ox, oy);
      ctx.rotate(r.roll);
      ctx.transform(1, 0, tiltSkew, 1, 0, 0);
      ctx.scale(s.hornSpread * (0.6 + 0.4 * yawK), 1);
      ctx.drawImage(this.horns, -hw / 2, -hh * 0.92, hw, hh);
      ctx.restore();
      if (s.hornFire) {
        const cr = Math.cos(r.roll);
        const sr = Math.sin(r.roll);
        const spread = s.hornSpread * (0.6 + 0.4 * yawK);
        const tip = (lx: number, ly: number) => {
          const x = lx * spread;
          return { x: ox + x * cr - ly * sr, y: oy + x * sr + ly * cr };
        };
        // open your mouth → the fire roars up
        const roar = s.exprMouth ? 1 + r.mouthOpen * 1.4 : 1;
        const flame = Math.max(22, r.width * 0.22 * s.hornSize) * roar;
        const L = tip(-hw * 0.4, -hh * 0.9);
        const R = tip(hw * 0.4, -hh * 0.9);
        drawHornFire(ctx, L.x, L.y, flame, now);
        drawHornFire(ctx, R.x, R.y, flame, now + 180);
      }
    }
  }

  private vampire(ctx: CanvasRenderingContext2D, r: FaceRig, view: ViewTransform | null, frame: HTMLCanvasElement | null, k: number, s: Settings) {
    if (view && frame) drawMappedVideo(ctx, r, view, frame, "grayscale(0.55) contrast(1.35) brightness(0.78) saturate(0.35)");
    ctx.save();
    clipOval(ctx, r);
    ctx.clip();
    ctx.globalAlpha = 0.4 * k;
    ctx.fillStyle = "rgba(230,220,225,0.55)";
    clipOval(ctx, r);
    ctx.fill();
    for (const e of [r.lEye, r.rEye]) {
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r.width * 0.19);
      g.addColorStop(0, "rgba(0,0,0,0.92)");
      g.addColorStop(0.5, "rgba(40,0,10,0.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, r.width * 0.17, r.height * 0.13, r.roll, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // eyes go wide (bloodshot) when you raise your brows; dead-white otherwise
    const wide = s.exprMouth ? Math.max(r.expr.eyeWideL, r.expr.eyeWideR, r.expr.browUp * 0.8) : 0;
    const sclera = wide > 0.3 ? "#f4e6e6" : "#f2eee8";
    const base = eyeSize(r, r.lEyePoly);
    const erx = base.rx * (1 + wide * 0.18);
    const ery = base.ry * (1 + wide * 0.35);
    eyeBall(ctx, r.lIris, erx, ery, r.roll, sclera, "#c9c2b8", "#1a120e");
    eyeBall(ctx, r.rIris, erx, ery, r.roll, sclera, "#c9c2b8", "#1a120e");
    if (wide > 0.3) {
      ctx.save();
      ctx.globalAlpha = k * Math.min(1, (wide - 0.3) * 2);
      ctx.strokeStyle = "rgba(170,0,0,0.75)";
      ctx.lineWidth = 1.2;
      for (const e of [r.lIris, r.rIris]) {
        for (let i = 0; i < 6; i++) {
          const a = -0.6 + i * 0.4 + (i % 2) * 0.1;
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(a) * erx * 0.45, e.y + Math.sin(a) * ery * 0.45);
          ctx.lineTo(e.x + Math.cos(a) * erx * 0.95, e.y + Math.sin(a) * ery * 0.95);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    const [bl, br] = blinks(r, s, view);
    drawEyelid(ctx, r.lIris, erx, ery, r.roll, bl, "#d9cfd0");
    drawEyelid(ctx, r.rIris, erx, ery, r.roll, br, "#d9cfd0");
    ctx.save();
    ctx.globalAlpha = k;
    ctx.strokeStyle = "rgba(130,0,12,0.9)";
    ctx.lineWidth = Math.max(2.5, r.width * 0.012);
    ctx.lineCap = "round";
    for (const e of [r.lEye, r.rEye]) {
      ctx.beginPath();
      ctx.moveTo(e.x, e.y + r.height * 0.04);
      ctx.quadraticCurveTo(e.x + r.width * 0.03, e.y + r.height * 0.16, e.x, e.y + r.height * 0.3);
      ctx.stroke();
    }
    ctx.fillStyle = "#4a040c";
    if (r.upperLip.length > 2) {
      poly(ctx, r.upperLip);
      ctx.fill();
    }
    if (r.lowerLip.length > 2) {
      poly(ctx, r.lowerLip);
      ctx.fill();
    }
    fillMouthCavity(ctx, r, "#120306");
    ctx.restore();
    drawFangs(ctx, r);
  }

}

export function punchFaces(ctx: CanvasRenderingContext2D, rigs: FaceRig[]) {
  if (!rigs.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.filter = "blur(8px)";
  for (const r of rigs) {
    ctx.beginPath();
    ctx.ellipse(r.cx, r.cy, r.width * 0.56, r.height * 0.58, r.roll, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
  ctx.restore();
}
