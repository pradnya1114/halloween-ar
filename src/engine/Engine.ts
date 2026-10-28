import type { Settings } from "../config/settings";
import { activeAssets, type GhostAsset } from "../lib/assets";
import { PersonDetector, type DetectionFrame, type DetectorStatus } from "../lib/detector";
import { computeView, drawRotated, mapPoint, STAGE_H, STAGE_W, videoCss, type ViewTransform } from "../lib/geometry";
import { buildObservation, buildObservationFromFace, PersonTracker, type Track } from "../lib/tracker";
import type { FaceDetection } from "../lib/faceTypes";
import { HorrorAudio } from "./audio";
import { collectRigs, FaceMaskRenderer, punchFaces } from "./faceMask";
import { HorrorFx } from "./fx";
import { GhostManager } from "./ghosts";
import { ParticleSystem } from "./particles";
import { createSpriteBank } from "./sprites";

export interface EngineStats {
  fps: number;
  detectFps: number;
  inferenceMs: number;
  people: number;
  tentative: number;
  ghosts: number;
  particles: number;
  videoW: number;
  videoH: number;
  trackIds: number[];
}

export interface EngineElements {
  video: HTMLVideoElement;
  back: HTMLCanvasElement;
  face: HTMLCanvasElement;
  front: HTMLCanvasElement;
  videoWrap: HTMLElement;
  redLayer: HTMLElement;
}

const PROC_LONG_SIDE = 640;

const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [0, 7], [0, 8],
];

export class HorrorEngine {
  readonly detector = new PersonDetector();
  readonly tracker = new PersonTracker({ confirmFrames: 4, lostTimeoutMs: 900 });
  readonly audio = new HorrorAudio();
  private sprites = createSpriteBank();
  private particles = new ParticleSystem(this.sprites);
  private ghosts: GhostManager;
  private fx: HorrorFx;
  private faceMask = new FaceMaskRenderer();
  private bctx: CanvasRenderingContext2D;
  private xctx: CanvasRenderingContext2D;
  private fctx: CanvasRenderingContext2D;
  private faces: FaceDetection[] = [];
  private proc = document.createElement("canvas");
  private pctx = this.proc.getContext("2d", { willReadFrequently: false })!;
  private view: ViewTransform | null = null;
  private viewKey = "";
  private mask: HTMLCanvasElement | null = null;
  private raf = 0;
  private last = 0;
  private lastDetect = 0;
  private lastVideoTime = -1;
  private frames = 0;
  private detects = 0;
  private statsAt = 0;
  private inferenceMs = 0;
  private lastPeople = -1;
  private detectorBusy = false;
  private lastAudioEvent = 0;
  private running = false;
  private lastTrackerTs = 0;

  constructor(
    private el: EngineElements,
    private getSettings: () => Settings,
    private getAssets: () => GhostAsset[],
    private onStats: (s: EngineStats) => void,
    private onDetectorStatus: (s: DetectorStatus) => void,
  ) {
    el.back.width = el.face.width = el.front.width = STAGE_W;
    el.back.height = el.face.height = el.front.height = STAGE_H;
    this.bctx = el.back.getContext("2d")!;
    this.xctx = el.face.getContext("2d")!;
    this.fctx = el.front.getContext("2d")!;
    this.ghosts = new GhostManager(this.particles, this.sprites, {
      onSpawn: (entrance) => {
        const s = this.getSettings();
        if (entrance === "teleport") {
          this.audio.zap();
          if (s.fx.glitch) this.fx.triggerGlitch(0.15);
        } else if (entrance === "flyin" || entrance === "rise") this.audio.whoosh();
        else this.audio.whisper();
        if (performance.now() - this.lastAudioEvent > 2500) {
          this.audio.stinger(0.8);
          this.lastAudioEvent = performance.now();
        }
        if (s.fx.redFlashes && Math.random() < 0.3) this.fx.triggerRedFlash(0.6 * s.effectIntensity);
      },
      onExit: () => {
        if (performance.now() - this.lastAudioEvent > 600) {
          this.audio.exitWhoosh();
          this.lastAudioEvent = performance.now();
        }
      },
    });
    this.detector.onResult = (frame, ts) => this.handleResult(frame, ts);
    this.fx = new HorrorFx(this.sprites, {
      onRedFlash: () => this.audio.thunder(),
      onFlock: (k) => (k === "crow" ? this.audio.caw() : this.audio.flutter()),
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.detector.close();
    this.audio.dispose();
  }

  /** Force a full reload (used by the Retry button after a load error). */
  reloadDetector() {
    this.detector.close();
    this.detectorBusy = false;
    return this.ensureDetector();
  }

  /** (Re)load the model when detection settings change. */
  async ensureDetector() {
    const s = this.getSettings();
    const opts = { model: s.model, maxPeople: s.maxPeople, confidence: s.detectionConfidence, masks: s.occlusion, bodyTracking: s.bodyTracking };
    if (this.detectorBusy || this.detector.sameOptions(opts)) return;
    this.detectorBusy = true;
    try {
      await this.detector.init(opts, this.onDetectorStatus);
    } catch (e) {
      console.error(e);
      this.detectorBusy = false;
      return;
    }
    this.detectorBusy = false;
    // settings may have changed while loading
    if (!this.detector.sameOptions({ model: this.getSettings().model, maxPeople: this.getSettings().maxPeople, confidence: this.getSettings().detectionConfidence, masks: this.getSettings().occlusion, bodyTracking: this.getSettings().bodyTracking }))
      this.ensureDetector();
  }

  resetTracking() {
    this.tracker.reset();
    this.ghosts.clear();
  }

  private loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    try {
      this.tick(now);
    } catch (e) {
      console.error("engine tick failed", e);
    }
  };

  private tick(now: number) {
    const s = this.getSettings();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    const { video } = this.el;
    this.tracker.cfg.confirmFrames = s.confirmFrames;
    this.tracker.cfg.lostTimeoutMs = s.lostTimeoutMs;

    const ready = video.readyState >= 2 && video.videoWidth > 0;
    if (ready) {
      const key = `${video.videoWidth}x${video.videoHeight}:${s.rotation}:${s.mirror}`;
      if (key !== this.viewKey) {
        this.viewKey = key;
        this.view = computeView(video.videoWidth, video.videoHeight, s.rotation, s.mirror);
        Object.assign(video.style, videoCss(this.view));
        this.resetTracking();
      }
      const interval = 1000 / s.detectFps;
      if (this.detector.ready && !this.detector.busy && now - this.lastDetect >= interval && video.currentTime !== this.lastVideoTime) {
        this.lastDetect = now;
        this.lastVideoTime = video.currentTime;
        this.detect(now, s);
      }
    } else if (now - this.lastDetect > 120) {
      // camera paused / lost: let tracks expire naturally
      this.lastDetect = now;
      this.lastTrackerTs = Math.max(now, this.lastTrackerTs + 1);
      this.tracker.update([], this.lastTrackerTs);
      this.mask = null;
    }

    const nowS = now / 1000;
    const assets = this.getAssets();
    const pool = activeAssets(assets, s.activeCollection, s.assetEnabled);
    this.ghosts.sync(this.tracker.tracks, nowS, s);
    this.ghosts.update(dt, nowS, s, pool);
    this.particles.update(dt);
    this.fx.update(dt, s, this.tracker.tracks, pool);

    const people = this.tracker.tracks.filter((t) => t.state === "confirmed").length;
    if (people !== this.lastPeople) {
      this.lastPeople = people;
      this.audio.setPeople(people);
    }
    this.audio.configure(s.sound, s.muted, s.volume);

    this.render(s, people);

    // DOM-driven effects
    this.el.videoWrap.style.transform = this.fx.glitchOffset ? `translateX(${this.fx.glitchOffset}px)` : "";
    this.el.redLayer.style.opacity = String(Math.min(1, this.fx.redLevel * 2.2));

    if (now - this.statsAt > 500) {
      const secs = (now - this.statsAt) / 1000;
      this.onStats({
        fps: Math.round(this.frames / secs),
        detectFps: Math.round(this.detects / secs),
        inferenceMs: Math.round(this.inferenceMs),
        people,
        tentative: this.tracker.tracks.length - people,
        ghosts: this.ghosts.ghostCount,
        particles: this.particles.count,
        videoW: video.videoWidth,
        videoH: video.videoHeight,
        trackIds: this.tracker.tracks.filter((t) => t.state === "confirmed").map((t) => t.id),
      });
      this.frames = 0;
      this.detects = 0;
      this.statsAt = now;
    }
  }

  private detect(now: number, s: Settings) {
    const v = this.view!;
    const k = PROC_LONG_SIDE / Math.max(v.rw, v.rh);
    const pw = Math.round(v.rw * Math.min(1, k));
    const ph = Math.round(v.rh * Math.min(1, k));
    if (this.proc.width !== pw || this.proc.height !== ph) {
      this.proc.width = pw;
      this.proc.height = ph;
    }
    drawRotated(this.pctx, this.el.video, s.rotation, pw, ph);
    this.detector.submit(this.proc, now);
  }

  private handleResult(frame: DetectionFrame, captureTs: number) {
    const v = this.view;
    if (!v) return;
    this.detects++;
    this.inferenceMs = this.inferenceMs * 0.8 + frame.inferenceMs * 0.2;
    this.faces = frame.faces ?? [];
    // Face-first: every detected face is a person. Body poses (if enabled) fill in
    // people whose face is turned away.
    const faceObs = this.faces.map((f) => buildObservationFromFace(f, v)).filter((o): o is NonNullable<typeof o> => !!o);
    const poseObs = frame.poses
      .map((p) => buildObservation(p, v))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .filter((po) => !faceObs.some((fo) => Math.hypot(fo.pts.head.x - po.pts.head.x, fo.pts.head.y - po.pts.head.y) < Math.max(fo.headR, po.headR) * 1.6));
    this.tracker.update([...faceObs, ...poseObs], Math.max(captureTs, this.lastTrackerTs + 1));
    this.lastTrackerTs = Math.max(captureTs, this.lastTrackerTs + 1);
    this.mask = frame.poses.length ? frame.mask : null;
  }

  private render(s: Settings, people: number) {
    const b = this.bctx;
    const x = this.xctx;
    const f = this.fctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, STAGE_W, STAGE_H);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, STAGE_W, STAGE_H);
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, STAGE_W, STAGE_H);

    const rigs = collectRigs(this.faces, this.tracker.tracks, this.view);

    // ---- back layer: silhouettes + ghosts behind people, then cut people AND faces out
    if (s.fx.silhouettes) this.fx.drawBackground(b, s);
    this.ghosts.draw(b, "back", s);
    if (s.occlusion && this.mask && this.view && people > 0) {
      const v = this.view;
      b.save();
      b.globalCompositeOperation = "destination-out";
      b.filter = "blur(5px)";
      if (v.mirror) b.setTransform(-1, 0, 0, 1, STAGE_W, 0);
      b.drawImage(this.mask, v.ox, v.oy, v.rw * v.s, v.rh * v.s);
      b.restore();
      b.filter = "none";
    }
    punchFaces(b, rigs);

    // ---- face makeup sits on the person, in front of behind-ghosts
    this.faceMask.draw(x, rigs, s, this.view, this.proc.width ? this.proc : null);

    // ---- front layer (never covers the face)
    this.ghosts.draw(f, "front", s);
    punchFaces(f, rigs);
    this.particles.draw(f);
    this.fx.drawForeground(f, s, this.view, this.proc.width ? this.proc : null);

    if (s.showDebug) this.drawDebug(f, s);
  }

  private drawDebug(ctx: CanvasRenderingContext2D, s: Settings) {
    const v = this.view;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.font = "bold 30px ui-monospace, monospace";
    for (const t of this.tracker.tracks) this.drawTrack(ctx, t, v);
    if (v) this.drawFaceDebug(ctx, v, s);
    ctx.restore();
  }

  /** Face-mode HUD: mesh outline, blink / mouth / head readouts. */
  private drawFaceDebug(ctx: CanvasRenderingContext2D, v: ViewTransform, _s: Settings) {
    ctx.save();
    ctx.font = "bold 26px ui-monospace, monospace";
    for (const f of this.faces) {
      const pts = f.landmarks;
      if (pts.length < 400) continue;
      ctx.fillStyle = "rgba(0,255,180,0.55)";
      for (let i = 0; i < pts.length; i += 3) {
        const p = mapPoint(v, pts[i].x, pts[i].y);
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
      const fh = mapPoint(v, pts[10].x, pts[10].y);
      const e = f.expr;
      const h = f.head;
      const deg = (r: number) => Math.round((r * 180) / Math.PI);
      const lines = [
        `blink L ${e.blinkL.toFixed(2)}  R ${e.blinkR.toFixed(2)}`,
        `mouth ${e.jawOpen.toFixed(2)}  smile ${e.smile.toFixed(2)}`,
        `brow ↑${e.browUp.toFixed(2)} ↓${e.browDown.toFixed(2)}`,
        `head yaw ${deg(h.yaw)}° pitch ${deg(h.pitch)}° roll ${deg(h.roll)}°`,
      ];
      let y = fh.y - 150;
      for (const ln of lines) {
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(fh.x - 200, y - 24, 400, 30);
        ctx.fillStyle = "#9ff";
        ctx.fillText(ln, fh.x - 195, y);
        y += 32;
      }
    }
    ctx.restore();
  }

  private drawTrack(ctx: CanvasRenderingContext2D, t: Track, v: ViewTransform | null) {
    const hue = (t.id * 67) % 360;
    const col = t.state === "confirmed" ? `hsl(${hue},90%,60%)` : "rgba(255,255,255,0.5)";
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (v && t.raw) {
      ctx.globalAlpha = 0.5;
      for (const [a, c] of SKELETON) {
        const p = mapPoint(v, t.raw[a].x, t.raw[a].y);
        const q = mapPoint(v, t.raw[c].x, t.raw[c].y);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (const p of Object.values(t.body.pts)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    const bb = t.body.bbox;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    ctx.setLineDash([]);
    ctx.fillText(`#${t.id} ${t.state}`, bb.x0, bb.y0 - 12);
  }
}
