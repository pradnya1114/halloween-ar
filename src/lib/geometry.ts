import type { CSSProperties } from "react";
import type { Rotation } from "../config/settings";

export const STAGE_W = 1080;
export const STAGE_H = 1920;

export interface Vec {
  x: number;
  y: number;
}

/**
 * Describes how the (optionally rotated) camera frame is laid out on the
 * 1080x1920 stage using "object-fit: cover" semantics.
 */
export interface ViewTransform {
  W: number;
  H: number;
  vw: number; // raw video width
  vh: number; // raw video height
  rw: number; // rotated frame width
  rh: number; // rotated frame height
  rotation: Rotation;
  mirror: boolean;
  s: number; // scale from rotated frame px to stage px
  ox: number; // stage offset of rotated frame
  oy: number;
}

export function computeView(
  vw: number,
  vh: number,
  rotation: Rotation,
  mirror: boolean,
  W = STAGE_W,
  H = STAGE_H,
): ViewTransform {
  const swap = rotation === 90 || rotation === 270;
  const rw = swap ? vh : vw;
  const rh = swap ? vw : vh;
  const s = Math.max(W / rw, H / rh);
  return { W, H, vw, vh, rw, rh, rotation, mirror, s, ox: (W - rw * s) / 2, oy: (H - rh * s) / 2 };
}

/** Map a normalized point of the rotated frame to stage pixels. */
export function mapPoint(v: ViewTransform, nx: number, ny: number): Vec {
  let x = v.ox + nx * v.rw * v.s;
  const y = v.oy + ny * v.rh * v.s;
  if (v.mirror) x = v.W - x;
  return { x, y };
}

/** CSS transform for the <video> element so it matches computeView(). */
export function videoCss(v: ViewTransform): CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: `${v.vw * v.s}px`,
    height: `${v.vh * v.s}px`,
    transform: `translate(-50%, -50%) ${v.mirror ? "scaleX(-1)" : ""} rotate(${v.rotation}deg)`,
    transformOrigin: "center center",
    maxWidth: "none",
  };
}

/** Draw the raw video into a canvas applying rotation (no mirroring). */
export function drawRotated(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  rotation: Rotation,
  outW: number,
  outH: number,
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const swap = rotation === 90 || rotation === 270;
  const dw = swap ? outH : outW;
  const dh = swap ? outW : outH;
  ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
