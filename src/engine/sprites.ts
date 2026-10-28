/** Procedurally generated sprites (no external files needed). */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Soft, lumpy smoke puff. */
export function makeSmokeSprite(seed: number, tint = "200,210,225"): HTMLCanvasElement {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext("2d")!;
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * S * 0.22;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const rad = S * (0.16 + rnd() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${tint},${0.18 + rnd() * 0.12})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  return c;
}

export function makeGlowSprite(color = "150,190,255"): HTMLCanvasElement {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${color},0.9)`);
  g.addColorStop(0.25, `rgba(${color},0.35)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

/** Horizontally tileable fog band. */
export function makeFogTexture(w = 1080, h = 560): HTMLCanvasElement {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const y = h * (0.25 + Math.random() * 0.75);
    const rad = 60 + Math.random() * 180;
    const a = 0.04 + Math.random() * 0.07;
    for (const dx of [-w, 0, w]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      g.addColorStop(0, `rgba(190,200,215,${a})`);
      g.addColorStop(1, "rgba(190,200,215,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    }
  }
  // fade top edge
  ctx.globalCompositeOperation = "destination-in";
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.4, "rgba(0,0,0,0.8)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  return c;
}

export interface SpriteBank {
  smoke: HTMLCanvasElement[];
  darkSmoke: HTMLCanvasElement[];
  glow: HTMLCanvasElement;
  redGlow: HTMLCanvasElement;
  fog: HTMLCanvasElement;
  fog2: HTMLCanvasElement;
}

export function createSpriteBank(): SpriteBank {
  return {
    smoke: [1, 2, 3, 4].map((s) => makeSmokeSprite(s)),
    darkSmoke: [5, 6].map((s) => makeSmokeSprite(s, "40,45,60")),
    glow: makeGlowSprite(),
    redGlow: makeGlowSprite("255,40,30"),
    fog: makeFogTexture(),
    fog2: makeFogTexture(),
  };
}
