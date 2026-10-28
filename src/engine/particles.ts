import { pick, rand } from "../lib/geometry";
import type { SpriteBank } from "./sprites";

type Kind = "smoke" | "darkSmoke" | "spark" | "flash" | "ring";

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  rot: number;
  vr: number;
  alpha: number;
  sprite?: HTMLCanvasElement;
}

const MAX_PARTICLES = 700;

export class ParticleSystem {
  private ps: Particle[] = [];
  constructor(private sprites: SpriteBank) {}

  get count() {
    return this.ps.length;
  }

  private push(p: Particle) {
    if (this.ps.length >= MAX_PARTICLES) this.ps.shift();
    this.ps.push(p);
  }

  smoke(x: number, y: number, n: number, spread: number, opts: { dark?: boolean; up?: number; size?: number } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const dark = opts.dark && Math.random() < 0.6;
      this.push({
        kind: dark ? "darkSmoke" : "smoke",
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r * 0.7,
        vx: Math.cos(a) * rand(10, 50),
        vy: -rand(10, 60) * (opts.up ?? 1),
        life: 0,
        max: rand(1.4, 2.8),
        size: (opts.size ?? 120) * rand(0.6, 1.3),
        grow: rand(30, 90),
        rot: Math.random() * 6.28,
        vr: rand(-0.6, 0.6),
        alpha: rand(0.5, 0.95),
        sprite: pick(dark ? this.sprites.darkSmoke : this.sprites.smoke),
      });
    }
  }

  sparks(x: number, y: number, n: number, speed = 400) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      this.push({
        kind: "spark",
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: rand(0.3, 0.8),
        size: rand(2, 5),
        grow: 0,
        rot: 0,
        vr: 0,
        alpha: 1,
      });
    }
  }

  flash(x: number, y: number, size: number, red = false) {
    this.push({ kind: "flash", x, y, vx: 0, vy: 0, life: 0, max: 0.45, size, grow: size * 2, rot: 0, vr: 0, alpha: 1, sprite: red ? this.sprites.redGlow : this.sprites.glow });
    this.push({ kind: "ring", x, y, vx: 0, vy: 0, life: 0, max: 0.5, size: size * 0.15, grow: size * 1.4, rot: 0, vr: 0, alpha: 0.45 });
  }

  update(dt: number) {
    const ps = this.ps;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark") {
        p.vx *= 0.93;
        p.vy = p.vy * 0.93 + 60 * dt;
      } else {
        p.vx *= 0.98;
        p.vy *= 0.985;
      }
      p.size += p.grow * dt;
      p.rot += p.vr * dt;
      ps[w++] = p;
    }
    ps.length = w;
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.ps) {
      const t = p.life / p.max;
      if (p.kind === "smoke" || p.kind === "darkSmoke") {
        const a = p.alpha * Math.sin(Math.PI * Math.min(1, t * 1.2)) ;
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(p.sprite!, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.kind === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = "rgb(190,220,255)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      } else if (p.kind === "flash") {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = (1 - t) * (1 - t);
        ctx.drawImage(p.sprite!, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalCompositeOperation = "source-over";
      } else if (p.kind === "ring") {
        ctx.globalAlpha = p.alpha * (1 - t);
        ctx.strokeStyle = "rgba(200,225,255,1)";
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
