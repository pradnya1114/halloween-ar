import type { Settings } from "../config/settings";
import type { GhostAsset } from "../lib/assets";
import { clamp, pick, rand, STAGE_H, STAGE_W, type ViewTransform } from "../lib/geometry";
import type { Track } from "../lib/tracker";
import type { SpriteBank } from "./sprites";

/* ---------------- flying creatures ---------------- */

interface Flyer {
  kind: "bat" | "crow";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  flapHz: number;
  wobble: number;
  baseY: number;
}

function drawBat(ctx: CanvasRenderingContext2D, f: Flyer, t: number) {
  const flap = Math.sin(t * f.flapHz * Math.PI * 2 + f.phase);
  const s = f.size;
  const dir = Math.sign(f.vx) || 1;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(dir, 1);
  ctx.fillStyle = "rgba(8,6,10,0.92)";
  const wy = flap * s * 0.55;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  // left wing
  ctx.quadraticCurveTo(-s * 0.4, -s * 0.2 + wy * 0.5, -s * 1.0, -s * 0.15 + wy);
  ctx.quadraticCurveTo(-s * 0.85, s * 0.05 + wy * 0.6, -s * 0.7, s * 0.1 + wy * 0.5);
  ctx.quadraticCurveTo(-s * 0.55, s * 0.0 + wy * 0.4, -s * 0.42, s * 0.16 + wy * 0.3);
  ctx.quadraticCurveTo(-s * 0.3, s * 0.05, -s * 0.1, s * 0.15);
  // body
  ctx.lineTo(0, s * 0.22);
  ctx.lineTo(s * 0.1, s * 0.15);
  // right wing (mirror)
  ctx.quadraticCurveTo(s * 0.3, s * 0.05, s * 0.42, s * 0.16 + wy * 0.3);
  ctx.quadraticCurveTo(s * 0.55, s * 0.0 + wy * 0.4, s * 0.7, s * 0.1 + wy * 0.5);
  ctx.quadraticCurveTo(s * 0.85, s * 0.05 + wy * 0.6, s * 1.0, -s * 0.15 + wy);
  ctx.quadraticCurveTo(s * 0.4, -s * 0.2 + wy * 0.5, 0, 0);
  ctx.fill();
  // ears / head
  ctx.beginPath();
  ctx.moveTo(-s * 0.08, -s * 0.02);
  ctx.lineTo(-s * 0.06, -s * 0.14);
  ctx.lineTo(0, -s * 0.04);
  ctx.lineTo(s * 0.06, -s * 0.14);
  ctx.lineTo(s * 0.08, -s * 0.02);
  ctx.fill();
  ctx.restore();
}

function drawCrow(ctx: CanvasRenderingContext2D, f: Flyer, t: number) {
  const flap = Math.sin(t * f.flapHz * Math.PI * 2 + f.phase);
  const s = f.size;
  const dir = Math.sign(f.vx) || 1;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(dir, 1);
  ctx.fillStyle = "rgba(5,5,8,0.95)";
  // body
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.45, s * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  // head + beak
  ctx.beginPath();
  ctx.arc(s * 0.45, -s * 0.04, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.54, -s * 0.07);
  ctx.lineTo(s * 0.74, -s * 0.01);
  ctx.lineTo(s * 0.54, s * 0.02);
  ctx.fill();
  // tail
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, -s * 0.04);
  ctx.lineTo(-s * 0.78, -s * 0.12);
  ctx.lineTo(-s * 0.74, s * 0.1);
  ctx.lineTo(-s * 0.4, s * 0.06);
  ctx.fill();
  // wings: feathered polygon swinging around the shoulder
  for (const side of [-1, 1]) {
    const wy = flap * s * 0.75 * side;
    const depth = side === -1 ? 0.75 : 1;
    ctx.globalAlpha = side === -1 ? 0.8 : 1;
    ctx.beginPath();
    ctx.moveTo(s * 0.18, -s * 0.05);
    ctx.quadraticCurveTo(s * 0.0, -s * 0.2 - wy * 0.5, -s * 0.2 * depth, -s * 0.15 - wy);
    for (let i = 0; i < 5; i++) {
      const fx = -s * (0.2 + i * 0.08) * depth;
      const fy = -s * (0.15 - i * 0.03) - wy * (1 - i * 0.12);
      ctx.lineTo(fx - s * 0.06, fy + s * 0.08);
      ctx.lineTo(fx - s * 0.02, fy + s * 0.03);
    }
    ctx.quadraticCurveTo(-s * 0.2, s * 0.02, -s * 0.1, s * 0.02);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------- background silhouettes ---------------- */

interface Silhouette {
  asset: GhostAsset;
  x: number;
  y: number;
  vx: number;
  h: number;
  t: number;
  dur: number;
  flip: number;
  peak: number;
}

export interface FxEvents {
  onRedFlash?: () => void;
  onFlock?: (kind: "bat" | "crow") => void;
  onFlicker?: () => void;
  onGlitch?: () => void;
}

export class HorrorFx {
  private flyers: Flyer[] = [];
  private silhouettes: Silhouette[] = [];
  private fogX = 0;
  private fogX2 = 0;
  private time = 0;
  private nextFlicker = rand(3, 7);
  private flickerT = -1;
  private flickerDur = 0;
  private darkness = 0;
  private red = 0;
  private nextRed = rand(12, 25);
  private nextFlock = rand(4, 9);
  private nextSil = rand(6, 14);
  private nextGlitch = rand(6, 14);
  glitchT = -1;
  private glitchDur = 0;
  /** exposed so the DOM layer can jitter the video */
  glitchOffset = 0;

  constructor(
    private sprites: SpriteBank,
    public events: FxEvents = {},
  ) {}

  /** 0..~0.35 – drives the DOM multiply layer */
  get redLevel() {
    return this.red;
  }

  triggerRedFlash(strength = 1) {
    this.red = Math.max(this.red, 0.32 * strength);
  }

  triggerGlitch(dur = 0.25) {
    this.glitchT = 0;
    this.glitchDur = dur;
  }

  update(dt: number, s: Settings, tracks: Track[], pool: GhostAsset[]) {
    const I = s.effectIntensity;
    this.time += dt;
    const t = this.time;
    const people = tracks.filter((x) => x.state === "confirmed");
    const busy = people.length > 0;

    this.fogX = (this.fogX + dt * 22) % STAGE_W;
    this.fogX2 = (this.fogX2 - dt * 14 + STAGE_W) % STAGE_W;

    // flicker bursts
    if (s.fx.flicker) {
      if (this.flickerT < 0 && t > this.nextFlicker) {
        this.flickerT = 0;
        this.flickerDur = rand(0.25, 1.1);
        this.events.onFlicker?.();
      }
      if (this.flickerT >= 0) {
        this.flickerT += dt;
        this.darkness = Math.random() < 0.45 ? rand(0.35, 0.8) * I : rand(0, 0.12);
        if (this.flickerT > this.flickerDur) {
          this.flickerT = -1;
          this.nextFlicker = t + rand(busy ? 3 : 6, busy ? 9 : 16) / Math.max(0.2, I);
        }
      } else {
        // subtle breathing of the light
        this.darkness = (0.06 + Math.sin(t * 0.7) * 0.04 + Math.sin(t * 2.3) * 0.02) * I;
      }
    } else this.darkness = 0;

    // red flashes
    if (s.fx.redFlashes && t > this.nextRed) {
      this.triggerRedFlash(I);
      this.events.onRedFlash?.();
      this.nextRed = t + rand(busy ? 10 : 18, busy ? 22 : 40);
    }
    this.red = Math.max(0, this.red - dt * 0.45);

    // glitch
    if (s.fx.glitch && this.glitchT < 0 && t > this.nextGlitch) {
      this.triggerGlitch(rand(0.12, 0.35));
      this.events.onGlitch?.();
      this.nextGlitch = t + rand(7, 18);
    }
    if (this.glitchT >= 0) {
      this.glitchT += dt;
      this.glitchOffset = Math.random() < 0.5 ? rand(-14, 14) * I : 0;
      if (this.glitchT > this.glitchDur) {
        this.glitchT = -1;
        this.glitchOffset = 0;
      }
    }

    // flocks over people's heads
    if ((s.fx.bats || s.fx.crows) && t > this.nextFlock) {
      const kinds: ("bat" | "crow")[] = [];
      if (s.fx.bats) kinds.push("bat");
      if (s.fx.crows) kinds.push("crow");
      const kind = pick(kinds);
      const topHead = people.length ? Math.min(...people.map((p) => p.body.pts.head.y - p.body.scale * 1.2)) : rand(250, 600);
      this.spawnFlock(kind, clamp(topHead, 120, STAGE_H * 0.55));
      this.events.onFlock?.(kind);
      this.nextFlock = t + (busy ? rand(8, 16) : rand(20, 40));
    }
    for (const f of this.flyers) {
      f.x += f.vx * dt;
      f.baseY += f.vy * dt;
      f.y = f.baseY + Math.sin(t * f.wobble + f.phase) * (f.kind === "bat" ? 28 : 10);
    }
    this.flyers = this.flyers.filter((f) => f.x > -300 && f.x < STAGE_W + 300);

    // background ghost silhouettes
    if (s.fx.silhouettes && pool.length && t > this.nextSil) {
      this.silhouettes.push({
        asset: pick(pool),
        x: rand(100, STAGE_W - 100),
        y: rand(STAGE_H * 0.2, STAGE_H * 0.6),
        vx: rand(-25, 25),
        h: rand(700, 1200),
        t: 0,
        dur: rand(5, 9),
        flip: Math.random() < 0.5 ? 1 : -1,
        peak: rand(0.1, 0.2) * (0.5 + I * 0.7),
      });
      this.nextSil = t + rand(10, 24);
    }
    for (const si of this.silhouettes) {
      si.t += dt;
      si.x += si.vx * dt;
    }
    this.silhouettes = this.silhouettes.filter((si) => si.t < si.dur);
  }

  private spawnFlock(kind: "bat" | "crow", y: number) {
    const fromLeft = Math.random() < 0.5;
    const n = kind === "bat" ? Math.round(rand(6, 13)) : Math.round(rand(2, 5));
    const speed = kind === "bat" ? rand(380, 560) : rand(240, 340);
    for (let i = 0; i < n; i++) {
      const size = kind === "bat" ? rand(32, 60) : rand(70, 110);
      this.flyers.push({
        kind,
        x: fromLeft ? -rand(60, 500) : STAGE_W + rand(60, 500),
        y,
        baseY: y + rand(-140, 140),
        vx: (fromLeft ? 1 : -1) * speed * rand(0.8, 1.2),
        vy: rand(-40, 20),
        size,
        phase: Math.random() * 6.28,
        flapHz: kind === "bat" ? rand(7, 11) : rand(2.2, 3.2),
        wobble: kind === "bat" ? rand(3, 6) : rand(1, 2),
      });
    }
  }

  /** drawn on the back layer (gets occluded by people) */
  drawBackground(ctx: CanvasRenderingContext2D, _s: Settings) {
    for (const si of this.silhouettes) {
      const p = si.t / si.dur;
      const a = Math.sin(Math.PI * p) * si.peak;
      const w = si.h * si.asset.aspect;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.filter = "blur(3px) brightness(0.55) contrast(1.2)";
      ctx.translate(si.x, si.y);
      ctx.scale(si.flip, 1);
      ctx.drawImage(si.asset.img, -w / 2, -si.h / 2, w, si.h);
      ctx.restore();
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  /** drawn on the front layer after ghosts */
  drawForeground(ctx: CanvasRenderingContext2D, s: Settings, view: ViewTransform | null, frame: HTMLCanvasElement | null) {
    const W = STAGE_W;
    const H = STAGE_H;
    const t = this.time;

    for (const f of this.flyers) (f.kind === "bat" ? drawBat : drawCrow)(ctx, f, t);

    if (s.fx.fog) {
      const d = s.fogDensity;
      const fog = this.sprites.fog;
      const fog2 = this.sprites.fog2;
      ctx.globalAlpha = 0.9 * d;
      ctx.drawImage(fog, this.fogX - W, H - fog.height, W, fog.height);
      ctx.drawImage(fog, this.fogX, H - fog.height, W, fog.height);
      ctx.globalAlpha = 0.55 * d;
      const y2 = H - fog2.height * 1.6 + Math.sin(t * 0.2) * 30;
      ctx.drawImage(fog2, this.fogX2 - W, y2, W, fog2.height * 1.4);
      ctx.drawImage(fog2, this.fogX2, y2, W, fog2.height * 1.4);
      // thin haze over the whole frame
      ctx.globalAlpha = 0.25 * d;
      ctx.drawImage(fog2, this.fogX - W, H * 0.15, W, H * 0.6);
      ctx.drawImage(fog2, this.fogX, H * 0.15, W, H * 0.6);
      ctx.globalAlpha = 1;
    }

    // glitch slices of the live frame + scanlines
    if (this.glitchT >= 0 && view && frame) {
      const bands = Math.round(rand(3, 8));
      ctx.save();
      for (let i = 0; i < bands; i++) {
        const y0 = rand(0, H);
        const bh = rand(8, 70);
        const sy = ((y0 - view.oy) / (view.rh * view.s)) * frame.height;
        const sh = (bh / (view.rh * view.s)) * frame.height;
        if (sy < 0 || sy + sh > frame.height) continue;
        const shift = rand(-60, 60);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (view.mirror) ctx.setTransform(-1, 0, 0, 1, W, 0);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(frame, 0, sy, frame.width, sh, view.ox + shift, y0, view.rw * view.s, bh);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = Math.random() < 0.5 ? "rgb(255,0,40)" : "rgb(0,200,255)";
        ctx.fillRect(view.ox + shift, y0, view.rw * view.s, bh);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#000";
      for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
      ctx.globalAlpha = 1;
    }

    // (blend-mode colour grading + red multiply live in DOM layers, see Stage)
    if (this.red > 0.003) {
      ctx.globalAlpha = this.red * 0.5;
      ctx.drawImage(this.sprites.redGlow, -W * 0.5, -H * 0.2, W * 2, H * 1.4);
      ctx.globalAlpha = 1;
    }

    if (this.darkness > 0.003) {
      ctx.globalAlpha = clamp(this.darkness, 0, 0.9);
      ctx.fillStyle = "#020306";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }
}
