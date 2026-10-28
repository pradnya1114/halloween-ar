import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FaceDetection } from "./faceTypes";
import { mapPoint, type Vec, type ViewTransform } from "./geometry";

/** BlazePose landmark indices */
export const LM = {
  nose: 0,
  lEye: 2,
  rEye: 5,
  lEar: 7,
  rEar: 8,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
} as const;

export const BODY_KEYS = [
  "head",
  "neck",
  "lShoulder",
  "rShoulder",
  "torso",
  "hip",
  "lHip",
  "rHip",
  "lKnee",
  "rKnee",
  "lAnkle",
  "rAnkle",
] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

/** Body in stage pixel coordinates. "l"/"r" refer to screen left/right. */
export interface Body {
  pts: Record<BodyKey, Vec>;
  scale: number; // ~ shoulder width in px (robust)
  headR: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface Observation extends Body {
  raw: NormalizedLandmark[];
  /** present when this observation came from the face model */
  face?: FaceDetection;
}

/* ------------------------------------------------------------------ */
/* Observation building                                                */
/* ------------------------------------------------------------------ */

const vis = (l: NormalizedLandmark | undefined) => (l ? (l.visibility ?? 1) : 0);

/**
 * Face-only mode: build a Body from the 478-point face mesh so ghosts,
 * occlusion and audio keep working without the pose model.
 * Shoulders / torso / hips are estimated from head size + head roll.
 */
export function buildObservationFromFace(face: FaceDetection, view: ViewTransform): Observation | null {
  const lms = face.landmarks;
  if (!lms || lms.length < 400) return null;
  const P = (i: number) => mapPoint(view, lms[i].x, lms[i].y);
  const forehead = P(10);
  const chin = P(152);
  const tA = P(234);
  const tB = P(454);
  const [lT, rT] = tA.x <= tB.x ? [tA, tB] : [tB, tA];
  const eA = P(33);
  const eB = P(263);
  const [lE, rE] = eA.x <= eB.x ? [eA, eB] : [eB, eA];
  const head = { x: (lT.x + rT.x) / 2, y: (forehead.y + chin.y) / 2 };
  const faceW = Math.max(Math.hypot(rT.x - lT.x, rT.y - lT.y), 40);
  const faceH = Math.max(Math.hypot(chin.x - forehead.x, chin.y - forehead.y), faceW * 1.2);
  const headR = faceH * 0.62;
  // down vector along the face (handles head tilt)
  const dl = Math.max(1, Math.hypot(chin.x - forehead.x, chin.y - forehead.y));
  const down = { x: (chin.x - forehead.x) / dl, y: (chin.y - forehead.y) / dl };
  const right = { x: -down.y, y: down.x };
  const at = (fx: number, fy: number) => ({ x: head.x + right.x * fx + down.x * fy, y: head.y + right.y * fx + down.y * fy });
  // anthropometric guesses (shoulder width ≈ 2.4 face widths)
  const scale = faceW * 2.4;
  const neck = at(0, faceH * 1.05);
  // "l"/"r" must mean SCREEN-left / SCREEN-right (ghost slots depend on it),
  // so sort every pair by x — this is handedness-safe under mirroring and head roll.
  const pair = (fx: number, fy: number): [Vec, Vec] => {
    const a = at(-fx, fy);
    const b = at(fx, fy);
    return a.x <= b.x ? [a, b] : [b, a];
  };
  const [lS, rS] = pair(scale * 0.5, faceH * 1.35);
  const hip = at(0, faceH * 3.9);
  const [lH, rH] = pair(scale * 0.32, faceH * 3.9);
  const [lK, rK] = pair(scale * 0.3, faceH * 5.8);
  const [lA, rA] = pair(scale * 0.3, faceH * 7.6);
  const torso = { x: (neck.x + hip.x) / 2, y: (neck.y + hip.y) / 2 };
  const bbox = {
    x0: Math.min(lT.x, lS.x) - faceW * 0.2,
    y0: forehead.y - faceH * 0.45,
    x1: Math.max(rT.x, rS.x) + faceW * 0.2,
    y1: Math.max(chin.y, lS.y, rS.y) + faceH * 0.3,
  };
  void lE;
  void rE;
  return {
    raw: lms,
    face,
    pts: { head, neck, lShoulder: lS, rShoulder: rS, torso, hip, lHip: lH, rHip: rH, lKnee: lK, rKnee: rK, lAnkle: lA, rAnkle: rA },
    scale,
    headR,
    bbox,
    confidence: 1,
  };
}

export function buildObservation(lms: NormalizedLandmark[], view: ViewTransform): Observation | null {
  if (!lms || lms.length < 29) return null;
  const P = (i: number) => mapPoint(view, lms[i].x, lms[i].y);
  const avg = (...v: Vec[]) => ({ x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length });

  const sA = P(LM.lShoulder);
  const sB = P(LM.rShoulder);
  const hA = P(LM.lHip);
  const hB = P(LM.rHip);
  // sort into screen-left / screen-right so mirroring never swaps slots
  const [lS, rS] = sA.x <= sB.x ? [sA, sB] : [sB, sA];
  const [lH, rH] = hA.x <= hB.x ? [hA, hB] : [hB, hA];
  const neck = avg(lS, rS);
  const hip = avg(lH, rH);
  const torsoLen = Math.hypot(hip.x - neck.x, hip.y - neck.y);
  const shoulderW = Math.hypot(rS.x - lS.x, rS.y - lS.y);

  // head: weighted average of visible face points
  const faceIdx = [LM.nose, LM.lEye, LM.rEye, LM.lEar, LM.rEar];
  let hx = 0,
    hy = 0,
    hw = 0;
  for (const i of faceIdx) {
    const w = Math.max(0.05, vis(lms[i]));
    const p = P(i);
    hx += p.x * w;
    hy += p.y * w;
    hw += w;
  }
  const head = { x: hx / hw, y: hy / hw };
  const earW = Math.hypot(P(LM.lEar).x - P(LM.rEar).x, P(LM.lEar).y - P(LM.rEar).y);
  const scale = Math.max(shoulderW, torsoLen * 0.75, earW * 2.2, 40);
  const headR = Math.max(earW * 0.75, scale * 0.28);

  // legs: use model prediction, but fall back to body proportions if very uncertain
  const down = torsoLen > 1 ? { x: (hip.x - neck.x) / torsoLen, y: (hip.y - neck.y) / torsoLen } : { x: 0, y: 1 };
  const leg = (iK: number, base: Vec, f: number) => {
    const p = P(iK);
    if (vis(lms[iK]) > 0.25) return p;
    return { x: base.x + down.x * torsoLen * f, y: base.y + down.y * torsoLen * f };
  };
  const kA = leg(LM.lKnee, hA, 0.95);
  const kB = leg(LM.rKnee, hB, 0.95);
  const aA = leg(LM.lAnkle, hA, 1.9);
  const aB = leg(LM.rAnkle, hB, 1.9);
  const [lK, rK] = kA.x <= kB.x ? [kA, kB] : [kB, kA];
  const [lA, rA] = aA.x <= aB.x ? [aA, aB] : [aB, aA];

  const core: number[] = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip];
  const confidence = core.reduce((s: number, i) => s + vis(lms[i]), 0) / core.length;

  const xs = [head.x - headR, head.x + headR, lS.x, rS.x, lH.x, rH.x];
  const ys = [head.y - headR * 1.3, hip.y, lS.y, rS.y];
  // include legs only if they're likely visible
  for (const [i, p] of [
    [LM.lKnee, kA],
    [LM.rKnee, kB],
    [LM.lAnkle, aA],
    [LM.rAnkle, aB],
  ] as [number, Vec][]) {
    if (vis(lms[i]) > 0.5) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const bbox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };

  return {
    raw: lms,
    pts: {
      head,
      neck,
      lShoulder: lS,
      rShoulder: rS,
      torso: avg(neck, hip),
      hip,
      lHip: lH,
      rHip: rH,
      lKnee: lK,
      rKnee: rK,
      lAnkle: lA,
      rAnkle: rA,
    },
    scale,
    headR,
    bbox,
    confidence,
  };
}

/* ------------------------------------------------------------------ */
/* One-Euro filter                                                      */
/* ------------------------------------------------------------------ */

class LowPass {
  y: number | null = null;
  filter(x: number, a: number) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

export class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;
  private prev: number | null = null;
  constructor(
    private minCutoff = 1.5,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v: number, tMs: number) {
    if (this.lastT === null || this.prev === null) {
      this.lastT = tMs;
      this.prev = v;
      this.dx.filter(0, 1);
      return this.x.filter(v, 1);
    }
    const dt = Math.max(1e-3, (tMs - this.lastT) / 1000);
    this.lastT = tMs;
    const d = (v - this.prev) / dt;
    this.prev = v;
    const ed = this.dx.filter(d, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(v, this.alpha(cutoff, dt));
  }
}

/* ------------------------------------------------------------------ */
/* Tracker                                                              */
/* ------------------------------------------------------------------ */

export type TrackState = "tentative" | "confirmed";

export interface Track {
  id: number;
  state: TrackState;
  body: Body; // smoothed
  hits: number;
  misses: number;
  firstSeen: number;
  lastSeen: number;
  confirmedAt: number;
  velocity: Vec; // px/s of torso
  raw: NormalizedLandmark[];
  /** latest face detection (expressions + head pose) when in face mode */
  face?: FaceDetection;
  filters: Record<string, OneEuro>;
}

export interface TrackerConfig {
  confirmFrames: number;
  lostTimeoutMs: number;
}

export interface TrackerEvents {
  confirmed: Track[];
  removed: Track[];
}

function iou(a: Body["bbox"], b: Body["bbox"]) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const ua = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return ua > 0 ? inter / ua : 0;
}

function cloneBody(b: Body): Body {
  const pts = {} as Record<BodyKey, Vec>;
  for (const k of BODY_KEYS) pts[k] = { ...b.pts[k] };
  return { pts, scale: b.scale, headR: b.headR, bbox: { ...b.bbox }, confidence: b.confidence };
}

export class PersonTracker {
  tracks: Track[] = [];
  private nextId = 1;
  constructor(public cfg: TrackerConfig) {}

  reset() {
    this.tracks = [];
  }

  /** Non-max suppression of duplicate poses of the same person. */
  private suppress(obs: Observation[]): Observation[] {
    const sorted = [...obs].sort((a, b) => b.confidence - a.confidence);
    const keep: Observation[] = [];
    for (const o of sorted) {
      const dup = keep.some((k) => {
        const d = Math.hypot(k.pts.neck.x - o.pts.neck.x, k.pts.neck.y - o.pts.neck.y);
        return iou(k.bbox, o.bbox) > 0.55 || d < Math.min(k.scale, o.scale) * 0.35;
      });
      if (!dup && o.confidence > 0.3) keep.push(o);
    }
    return keep;
  }

  private predicted(t: Track, now: number): Vec {
    const dt = Math.min(0.25, (now - t.lastSeen) / 1000);
    return { x: t.body.pts.torso.x + t.velocity.x * dt, y: t.body.pts.torso.y + t.velocity.y * dt };
  }

  update(rawObs: Observation[], now: number): TrackerEvents {
    const obs = this.suppress(rawObs);
    const events: TrackerEvents = { confirmed: [], removed: [] };

    // cost matrix -> greedy assignment (small N, works well in practice)
    const pairs: { ti: number; oi: number; cost: number }[] = [];
    this.tracks.forEach((t, ti) => {
      const pred = this.predicted(t, now);
      obs.forEach((o, oi) => {
        const scale = Math.max(t.body.scale, o.scale);
        const d = Math.hypot(pred.x - o.pts.torso.x, pred.y - o.pts.torso.y) / scale;
        const sizeRatio = Math.abs(Math.log(o.scale / t.body.scale));
        if (d > 2.2 || sizeRatio > 0.9) return;
        const cost = d + 0.6 * (1 - iou(t.body.bbox, o.bbox)) + 0.4 * sizeRatio;
        pairs.push({ ti, oi, cost });
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);
    const usedT = new Set<number>();
    const usedO = new Set<number>();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedO.has(p.oi)) continue;
      usedT.add(p.ti);
      usedO.add(p.oi);
      this.applyObservation(this.tracks[p.ti], obs[p.oi], now);
    }

    // unmatched tracks
    const survivors: Track[] = [];
    this.tracks.forEach((t, ti) => {
      if (!usedT.has(ti)) {
        t.misses++;
        // coast with damped velocity
        t.velocity.x *= 0.8;
        t.velocity.y *= 0.8;
        // confirmed people need BOTH several missed detection frames and the
        // timeout, so slow inference never drops a person between frames
        const gone = t.state === "tentative" ? t.misses > 2 : t.misses >= 3 && now - t.lastSeen > this.cfg.lostTimeoutMs;
        if (gone) {
          if (t.state === "confirmed") events.removed.push(t);
          return;
        }
      }
      if (t.state === "tentative" && t.hits >= this.cfg.confirmFrames) {
        t.state = "confirmed";
        t.confirmedAt = now;
        events.confirmed.push(t);
      }
      survivors.push(t);
    });
    this.tracks = survivors;

    // unmatched observations -> new tentative tracks
    obs.forEach((o, oi) => {
      if (usedO.has(oi)) return;
      const t: Track = {
        id: this.nextId++,
        state: "tentative",
        body: cloneBody(o),
        hits: 1,
        misses: 0,
        firstSeen: now,
        lastSeen: now,
        confirmedAt: 0,
        velocity: { x: 0, y: 0 },
        raw: o.raw,
        face: o.face,
        filters: {},
      };
      this.applyObservation(t, o, now, true);
      this.tracks.push(t);
    });
    return events;
  }

  private filt(t: Track, key: string, v: number, now: number, minCutoff = 1.2, beta = 0.008) {
    let f = t.filters[key];
    if (!f) f = t.filters[key] = new OneEuro(minCutoff, beta);
    return f.filter(v, now);
  }

  private applyObservation(t: Track, o: Observation, now: number, fresh = false) {
    const prevTorso = { ...t.body.pts.torso };
    const dt = Math.max(1e-3, (now - t.lastSeen) / 1000);
    for (const k of BODY_KEYS) {
      t.body.pts[k] = {
        x: this.filt(t, k + "x", o.pts[k].x, now),
        y: this.filt(t, k + "y", o.pts[k].y, now),
      };
    }
    t.body.scale = this.filt(t, "scale", o.scale, now, 0.8, 0.002);
    t.body.headR = this.filt(t, "headR", o.headR, now, 0.8, 0.002);
    t.body.bbox = { ...o.bbox };
    t.body.confidence = o.confidence;
    if (!fresh) {
      const vx = (t.body.pts.torso.x - prevTorso.x) / dt;
      const vy = (t.body.pts.torso.y - prevTorso.y) / dt;
      t.velocity.x = t.velocity.x * 0.6 + vx * 0.4;
      t.velocity.y = t.velocity.y * 0.6 + vy * 0.4;
      t.hits++;
    }
    t.misses = 0;
    t.lastSeen = now;
    t.raw = o.raw;
    if (o.face) t.face = o.face;
  }
}
