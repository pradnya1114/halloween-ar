import type { EntranceType, ExitType, Settings } from "../config/settings";
import type { GhostAsset } from "../lib/assets";
import {
  clamp,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  lerp,
  pick,
  rand,
  STAGE_H,
  STAGE_W,
  type Vec,
} from "../lib/geometry";
import type { Body, Track } from "../lib/tracker";
import type { ParticleSystem } from "./particles";
import type { SpriteBank } from "./sprites";

/* ------------------------------------------------------------------ */
/* Slots around the body                                                */
/* ------------------------------------------------------------------ */

export type Slot = "headL" | "headR" | "aboveHead" | "shoulderL" | "shoulderR" | "legL" | "legR" | "waistL" | "waistR";
type Layer = "back" | "front";

const SLOT_ORDER: Slot[] = ["shoulderL", "shoulderR", "waistL", "waistR", "legL", "legR", "headL", "headR"];

const SLOT_DEF: Record<Slot, { size: number; layer: Layer | "either" }> = {
  headL: { size: 0.7, layer: "back" },
  headR: { size: 0.7, layer: "back" },
  aboveHead: { size: 0.65, layer: "back" },
  shoulderL: { size: 0.85, layer: "back" },
  shoulderR: { size: 0.85, layer: "back" },
  legL: { size: 0.65, layer: "back" },
  legR: { size: 0.65, layer: "back" },
  waistL: { size: 0.8, layer: "back" },
  waistR: { size: 0.8, layer: "back" },
};

function slotAnchor(slot: Slot, b: Body): Vec {
  const s = b.scale;
  const p = b.pts;
  let v: Vec;
  switch (slot) {
    case "headL":
      v = { x: p.head.x - s * 1.85, y: p.head.y - s * 0.05 };
      break;
    case "headR":
      v = { x: p.head.x + s * 1.85, y: p.head.y - s * 0.05 };
      break;
    case "aboveHead":
      v = { x: p.head.x + s * 0.9, y: p.head.y - s * 1.35 };
      break;
    case "shoulderL":
      v = { x: p.lShoulder.x - s * 1.15, y: p.lShoulder.y - s * 0.35 };
      break;
    case "shoulderR":
      v = { x: p.rShoulder.x + s * 1.15, y: p.rShoulder.y - s * 0.35 };
      break;
    case "legL":
      v = { x: p.lKnee.x - s * 1.2, y: p.lKnee.y };
      break;
    case "legR":
      v = { x: p.rKnee.x + s * 1.2, y: p.rKnee.y };
      break;
    case "waistL":
      v = { x: p.lHip.x - s * 1.55, y: p.hip.y - s * 0.2 };
      break;
    case "waistR":
      v = { x: p.rHip.x + s * 1.55, y: p.hip.y - s * 0.2 };
      break;
  }
  return { x: clamp(v.x, 60, STAGE_W - 60), y: clamp(v.y, 140, STAGE_H - 160) };
}

const slotSide = (slot: Slot) => (slot.endsWith("L") ? -1 : slot.endsWith("R") ? 1 : 0);

/* ------------------------------------------------------------------ */
/* Ghost                                                                */
/* ------------------------------------------------------------------ */

type GhostState = "waiting" | "entering" | "alive" | "leaving";

interface Ghost {
  id: number;
  slot: Slot;
  asset: GhostAsset | null;
  layer: Layer;
  entrance: EntranceType;
  exit: ExitType;
  state: GhostState;
  t: number;
  spawnAt: number;
  lifeEnd: number;
  pos: Vec;
  prev: Vec;
  vel: Vec;
  start: Vec;
  ctrl: Vec;
  seed: number;
  flip: 1 | -1;
  exitVel: Vec;
  exitRot: number;
  lunge: number; // -1 = idle
  nextLunge: number;
  emitAcc: number;
  // render outputs
  rx: number;
  ry: number;
  rot: number;
  sc: number;
  sx: number;
  alpha: number;
  blur: number;
  echoes: number;
  chroma: number;
  h: number;
}

interface Group {
  trackId: number;
  track: Track;
  ghosts: Ghost[];
  present: boolean;
}

export interface GhostEvents {
  onSpawn?: (entrance: EntranceType, x: number, y: number) => void;
  onExit?: (exit: ExitType) => void;
}

const ENTRANCE_DUR: Record<EntranceType, number> = { rise: 1.7, smoke: 2.1, flyin: 1.35, shoulder: 1.5, teleport: 0.95 };
const EXIT_DUR: Record<ExitType, number> = { flyaway: 1.7, dissolve: 1.9, fade: 1.3 };

let GID = 1;

export class GhostManager {
  groups = new Map<number, Group>();
  private leftovers: Group[] = [];

  constructor(
    private particles: ParticleSystem,
    private sprites: SpriteBank,
    public events: GhostEvents = {},
  ) {}

  get ghostCount() {
    let n = 0;
    for (const g of [...this.groups.values(), ...this.leftovers]) n += g.ghosts.filter((x) => x.state !== "waiting").length;
    return n;
  }

  clear() {
    this.groups.clear();
    this.leftovers = [];
  }

  /** Keep groups in sync with confirmed tracks (one group per person). */
  sync(tracks: Track[], now: number, s: Settings) {
    const alive = new Set<number>();
    for (const t of tracks) {
      if (t.state !== "confirmed") continue;
      alive.add(t.id);
      if (!this.groups.has(t.id)) this.groups.set(t.id, this.createGroup(t, now, s));
    }
    for (const [id, g] of this.groups) {
      if (!alive.has(id)) {
        this.release(g);
        this.groups.delete(id);
        this.leftovers.push(g);
      }
    }
  }

  private createGroup(track: Track, now: number, s: Settings): Group {
    const order = [...SLOT_ORDER];
    // light shuffle so groups don't look identical
    for (let i = 0; i < order.length - 1; i++) if (Math.random() < 0.35) [order[i], order[i + 1]] = [order[i + 1], order[i]];
    const g: Group = { trackId: track.id, track, ghosts: [], present: true };
    const n = clamp(Math.round(s.ghostsPerPerson), 0, SLOT_ORDER.length);
    for (let i = 0; i < n; i++) {
      g.ghosts.push(this.makeGhost(order[i], now + s.spawnDelay + i * s.spawnInterval * rand(0.6, 1.4)));
    }
    return g;
  }

  private makeGhost(slot: Slot, spawnAt: number): Ghost {
    const def = SLOT_DEF[slot];
    const layer: Layer = def.layer === "either" ? (Math.random() < 0.5 ? "back" : "front") : def.layer;
    return {
      id: GID++,
      slot,
      asset: null,
      layer,
      entrance: "smoke",
      exit: "fade",
      state: "waiting",
      t: 0,
      spawnAt,
      lifeEnd: Infinity,
      pos: { x: 0, y: 0 },
      prev: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
      ctrl: { x: 0, y: 0 },
      seed: Math.random() * 100,
      flip: Math.random() < 0.5 ? 1 : -1,
      exitVel: { x: 0, y: 0 },
      exitRot: 0,
      lunge: -1,
      nextLunge: 0,
      emitAcc: 0,
      rx: 0,
      ry: 0,
      rot: 0,
      sc: 1,
      sx: 1,
      alpha: 0,
      blur: 0,
      echoes: 0,
      chroma: 0,
      h: 300,
    };
  }

  private release(g: Group) {
    g.present = false;
    g.ghosts = g.ghosts.filter((x) => x.state !== "waiting");
    g.ghosts.forEach((x, i) => this.beginExit(x, null, -i * rand(0.06, 0.18)));
  }

  private pickAsset(g: Group, pool: GhostAsset[]): GhostAsset | null {
    if (!pool.length) return null;
    const used = new Set(g.ghosts.filter((x) => x.state !== "waiting" && x.asset).map((x) => x.asset!.id));
    const fresh = pool.filter((a) => !used.has(a.id));
    return pick(fresh.length ? fresh : pool);
  }

  private chooseEntrance(slot: Slot, s: Settings): EntranceType {
    const enabled = (Object.keys(s.entrances) as EntranceType[]).filter((k) => s.entrances[k]);
    if (!enabled.length) return "smoke";
    if (slot.startsWith("shoulder") && s.entrances.shoulder && Math.random() < 0.6) return "shoulder";
    return pick(enabled);
  }

  private chooseExit(s: Settings): ExitType {
    const enabled = (Object.keys(s.exits) as ExitType[]).filter((k) => s.exits[k]);
    return enabled.length ? pick(enabled) : "fade";
  }

  private settingsRef: Settings | null = null;

  private beginExit(gh: Ghost, s: Settings | null, delay = 0) {
    if (gh.state === "leaving") return;
    const st = s ?? this.settingsRef;
    gh.exit = st ? this.chooseExit(st) : "fade";
    gh.state = "leaving";
    gh.t = delay;
    gh.exitVel = { x: 0, y: 0 };
    gh.exitRot = rand(-1.5, 1.5);
    this.events.onExit?.(gh.exit);
  }

  private spawn(g: Group, gh: Ghost, now: number, s: Settings, pool: GhostAsset[]) {
    const asset = this.pickAsset(g, pool);
    if (!asset) {
      gh.spawnAt = now + 1; // retry when assets become available
      return;
    }
    const b = g.track.body;
    gh.asset = asset;
    gh.entrance = this.chooseEntrance(gh.slot, s);
    if (gh.entrance === "shoulder") gh.layer = "back";
    gh.state = "entering";
    gh.t = 0;
    gh.pos = slotAnchor(gh.slot, b);
    gh.prev = { ...gh.pos };
    gh.lifeEnd = s.cycleGhosts ? now + s.cycleSeconds * rand(0.7, 1.3) : Infinity;
    gh.nextLunge = now + rand(5, 12);
    const side = slotSide(gh.slot) || (gh.pos.x < STAGE_W / 2 ? -1 : 1);
    gh.flip = side < 0 ? (Math.random() < 0.7 ? 1 : -1) : Math.random() < 0.7 ? -1 : 1;
    // entrance-specific setup
    switch (gh.entrance) {
      case "flyin": {
        const fromLeft = gh.pos.x < STAGE_W / 2 ? Math.random() < 0.8 : Math.random() < 0.2;
        gh.start = { x: fromLeft ? -350 : STAGE_W + 350, y: gh.pos.y + rand(-500, 250) };
        gh.ctrl = { x: lerp(gh.start.x, gh.pos.x, 0.5), y: Math.min(gh.start.y, gh.pos.y) - rand(150, 400) };
        break;
      }
      case "shoulder": {
        const sh = side < 0 ? b.pts.lShoulder : b.pts.rShoulder;
        gh.start = { x: lerp(sh.x, b.pts.neck.x, 0.4), y: sh.y };
        break;
      }
      case "rise":
        gh.start = { x: gh.pos.x + rand(-60, 60), y: STAGE_H + 250 };
        break;
      case "smoke":
        this.particles.smoke(gh.pos.x, gh.pos.y, 16, b.scale * 0.6, { dark: true, size: b.scale * 0.9 });
        break;
      case "teleport":
        this.particles.flash(gh.pos.x, gh.pos.y, b.scale * 2.4);
        this.particles.sparks(gh.pos.x, gh.pos.y, 40, 520);
        break;
    }
    this.events.onSpawn?.(gh.entrance, gh.pos.x, gh.pos.y);
  }

  update(dtReal: number, nowS: number, s: Settings, pool: GhostAsset[]) {
    this.settingsRef = s;
    const sp = s.animSpeed;
    const dt = dtReal * sp;

    for (const g of this.groups.values()) {
      // adjust number of ghosts if the setting changed
      const want = clamp(Math.round(s.ghostsPerPerson), 0, SLOT_ORDER.length);
      const active = g.ghosts.filter((x) => x.state !== "leaving");
      if (active.length < want) {
        const usedSlots = new Set(active.map((x) => x.slot));
        const free = SLOT_ORDER.filter((sl) => !usedSlots.has(sl));
        for (let i = 0; i < want - active.length && i < free.length; i++)
          g.ghosts.push(this.makeGhost(free[i], nowS + s.spawnInterval * (i + rand(0.3, 1))));
      } else if (active.length > want) {
        active.slice(want).forEach((x) => (x.state === "waiting" ? (x.state = "leaving") : this.beginExit(x, s)));
      }
      // cycling: retire old ghosts and schedule replacements in the same slot
      for (const gh of [...g.ghosts]) {
        if (gh.state === "alive" && nowS > gh.lifeEnd) {
          this.beginExit(gh, s);
          g.ghosts.push(this.makeGhost(gh.slot, nowS + s.spawnInterval * rand(1.2, 2.2)));
        }
        if (gh.state === "waiting" && nowS >= gh.spawnAt) this.spawn(g, gh, nowS, s, pool);
      }
    }

    for (const g of [...this.groups.values(), ...this.leftovers]) {
      g.ghosts = g.ghosts.filter((gh) => {
        if (gh.state === "waiting") return true;
        if (gh.state === "leaving" && !gh.asset) return false;
        return this.updateGhost(gh, g, dt, dtReal, nowS, s);
      });
    }
    this.leftovers = this.leftovers.filter((g) => g.ghosts.length > 0);
  }

  /** returns false when the ghost is finished */
  private updateGhost(gh: Ghost, g: Group, dt: number, dtReal: number, nowS: number, s: Settings): boolean {
    const b = g.track.body;
    const sc0 = b.scale;
    const assetScale = gh.asset ? (s.assetScale[gh.asset.id] ?? 1) : 1;
    gh.h = clamp(sc0 * SLOT_DEF[gh.slot].size * 0.9 * s.ghostSize * assetScale, 70, Math.min(520, STAGE_H * 0.28));
    gh.t += dt;

    // follow the person (spring), unless flying away
    const tt = nowS * s.animSpeed + gh.seed * 10;
    if (gh.state !== "leaving" || gh.t < 0 || gh.exit !== "flyaway") {
      const a = slotAnchor(gh.slot, b);
      const target = {
        x: a.x + Math.sin(tt * 0.7) * sc0 * 0.18 + Math.sin(tt * 1.9 + gh.seed) * sc0 * 0.05,
        y: a.y + Math.sin(tt * 1.1 + gh.seed * 3) * sc0 * 0.14,
      };
      const k = g.present ? 1 - Math.exp(-4.5 * dtReal) : 1 - Math.exp(-1.2 * dtReal);
      gh.pos.x += (target.x - gh.pos.x) * k;
      gh.pos.y += (target.y - gh.pos.y) * k;
    }

    // defaults: idle float
    gh.rx = gh.pos.x;
    gh.ry = gh.pos.y;
    gh.rot = Math.sin(tt * 0.5 + gh.seed) * 0.09;
    gh.sc = 1 + Math.sin(tt * 1.3 + gh.seed) * 0.04;
    gh.sx = 1 + Math.sin(tt * 0.9) * 0.025;
    gh.alpha = 1;
    gh.blur = 0;
    gh.echoes = 0;
    gh.chroma = 0;

    if (gh.state === "entering") {
      const dur = ENTRANCE_DUR[gh.entrance];
      const p = clamp(gh.t / dur, 0, 1);
      const e = easeOutCubic(p);
      switch (gh.entrance) {
        case "rise":
          gh.rx = lerp(gh.start.x, gh.pos.x, e);
          gh.ry = lerp(gh.start.y, gh.pos.y, e);
          gh.alpha = Math.min(1, p * 1.8);
          gh.rot += Math.sin(p * 14) * 0.12 * (1 - p);
          gh.sx *= 1 - 0.25 * (1 - p);
          gh.sc *= 0.85 + 0.15 * e;
          this.emit(gh, dt, 14 * (1 - p), () => this.particles.smoke(gh.rx, gh.ry + gh.h * 0.35, 1, gh.h * 0.15, { dark: true, size: gh.h * 0.35 }));
          break;
        case "smoke":
          gh.alpha = p * p;
          gh.blur = (1 - p) * 18;
          gh.sc *= 0.7 + 0.3 * easeOutBack(p);
          gh.sx *= 1 + Math.sin(p * 22) * 0.1 * (1 - p);
          if (p < 0.75) this.emit(gh, dt, 18, () => this.particles.smoke(gh.rx, gh.ry, 1, gh.h * 0.3, { size: gh.h * 0.4 }));
          break;
        case "flyin": {
          const u = e;
          const x = (1 - u) * (1 - u) * gh.start.x + 2 * (1 - u) * u * gh.ctrl.x + u * u * gh.pos.x;
          const y = (1 - u) * (1 - u) * gh.start.y + 2 * (1 - u) * u * gh.ctrl.y + u * u * gh.pos.y;
          gh.rx = x;
          gh.ry = y;
          gh.rot += clamp((gh.pos.x - gh.start.x) / 2000, -0.5, 0.5) * (1 - p);
          gh.alpha = Math.min(1, p * 3);
          gh.echoes = Math.round(4 * (1 - p));
          gh.sx *= 1 + 0.25 * (1 - p);
          break;
        }
        case "shoulder":
          gh.rx = lerp(gh.start.x, gh.pos.x, e);
          gh.ry = lerp(gh.start.y, gh.pos.y, e);
          gh.sc *= 0.35 + 0.65 * e;
          gh.alpha = Math.min(1, p * 2.2);
          gh.rot += (slotSide(gh.slot) || 1) * 0.35 * (1 - e);
          break;
        case "teleport": {
          const visible = p > 0.12 && (p > 0.85 || Math.random() < 0.35 + p * 0.6);
          gh.alpha = visible ? 1 : 0;
          const j = (1 - p) * sc0 * 0.35;
          gh.rx += rand(-j, j);
          gh.ry += rand(-j * 0.4, j * 0.4);
          gh.chroma = 1 - p;
          gh.sx *= 1 + rand(-0.15, 0.15) * (1 - p);
          break;
        }
      }
      if (p >= 1) {
        gh.state = "alive";
        gh.t = 0;
      }
    } else if (gh.state === "alive") {
      // occasional lunge toward the viewer
      if (gh.lunge < 0 && nowS > gh.nextLunge) gh.lunge = 0;
      if (gh.lunge >= 0) {
        gh.lunge += dt / 0.9;
        const l = Math.sin(Math.PI * Math.min(1, gh.lunge));
        gh.sc *= 1 + l * 0.08;
        gh.chroma = l * 0.4;
        if (gh.lunge >= 1) {
          gh.lunge = -1;
          gh.nextLunge = nowS + rand(7, 16) / s.animSpeed;
        }
      }
      // subtle supernatural flicker
      if (Math.sin(tt * 3.1 + gh.seed) > 0.985) gh.alpha = 0.55;
    } else if (gh.state === "leaving") {
      if (gh.t < 0) return true; // staggered departure
      const dur = EXIT_DUR[gh.exit];
      const p = clamp(gh.t / dur, 0, 1);
      switch (gh.exit) {
        case "flyaway": {
          if (gh.exitVel.x === 0 && gh.exitVel.y === 0) {
            const dir = Math.sign(gh.pos.x - b.pts.torso.x) || (Math.random() < 0.5 ? -1 : 1);
            gh.exitVel = { x: dir * rand(350, 750), y: -rand(450, 850) };
          }
          gh.exitVel.x *= 1 + dt * 1.6;
          gh.exitVel.y *= 1 + dt * 1.6;
          gh.pos.x += gh.exitVel.x * dt;
          gh.pos.y += gh.exitVel.y * dt;
          gh.rx = gh.pos.x;
          gh.ry = gh.pos.y;
          gh.rot += gh.exitRot * p;
          gh.alpha = 1 - p * p;
          gh.sc *= 1 - 0.35 * p;
          gh.echoes = 3;
          break;
        }
        case "dissolve":
          gh.alpha = 1 - easeInCubic(p);
          gh.blur = p * 16;
          gh.sc *= 1 + 0.18 * p;
          gh.ry -= p * 60;
          if (p < 0.8) this.emit(gh, dt, 24, () => this.particles.smoke(gh.rx, gh.ry, 1, gh.h * 0.32, { dark: true, size: gh.h * 0.45, up: 1.5 }));
          break;
        case "fade":
          gh.alpha = (1 - p) * (Math.random() < 0.72 ? 1 : 0.15);
          gh.chroma = p * 0.6;
          gh.sx *= 1 + Math.sin(p * 40) * 0.05;
          break;
      }
      if (p >= 1) return false;
    }

    gh.vel.x = (gh.rx - gh.prev.x) / Math.max(1e-3, dtReal);
    gh.vel.y = (gh.ry - gh.prev.y) / Math.max(1e-3, dtReal);
    gh.prev.x = gh.rx;
    gh.prev.y = gh.ry;
    return true;
  }

  private emit(gh: Ghost, dt: number, rate: number, fn: () => void) {
    gh.emitAcc += dt * rate;
    while (gh.emitAcc >= 1) {
      gh.emitAcc -= 1;
      fn();
    }
  }

  draw(ctx: CanvasRenderingContext2D, layer: Layer, s: Settings) {
    for (const g of [...this.leftovers, ...this.groups.values()]) {
      for (const gh of g.ghosts) {
        if (gh.state === "waiting" || gh.layer !== layer || !gh.asset) continue;
        if (gh.state === "leaving" && gh.t < 0 && gh.alpha <= 0) continue;
        this.drawGhost(ctx, gh, s.ghostOpacity);
      }
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, gh: Ghost, opacity: number) {
    const a = gh.alpha * opacity;
    if (a <= 0.005 || !gh.asset) return;
    const img = gh.asset.img;
    const h = gh.h;
    const w = h * gh.asset.aspect;
    const place = (dx: number, dy: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(gh.rx + dx, gh.ry + dy);
      ctx.rotate(gh.rot);
      ctx.scale(gh.flip * gh.sc * gh.sx, gh.sc);
    };

    // spectral glow
    place(0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a * 0.16;
    ctx.drawImage(this.sprites.glow, -w * 0.75, -h * 0.6, w * 1.5, h * 1.2);
    ctx.globalCompositeOperation = "source-over";

    if (gh.blur > 0.5) ctx.filter = `blur(${gh.blur.toFixed(1)}px)`;

    // motion echoes
    for (let e = gh.echoes; e >= 1; e--) {
      place(-gh.vel.x * 0.03 * e, -gh.vel.y * 0.03 * e);
      ctx.globalAlpha = (a * 0.28) / e;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }

    // chromatic split
    if (gh.chroma > 0.02) {
      ctx.globalCompositeOperation = "lighter";
      const off = gh.chroma * 16;
      ctx.globalAlpha = a * 0.35 * gh.chroma;
      place(-off, 0);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      place(off, off * 0.3);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.globalCompositeOperation = "source-over";
    }

    place(0, 0);
    ctx.globalAlpha = a;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);

    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
