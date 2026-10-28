import type { MPMask } from "@mediapipe/tasks-vision";

/**
 * Combines per-person segmentation masks into one RGBA buffer whose alpha
 * channel is the union of all silhouettes (used to hide ghosts behind people).
 */
export function buildMaskRGBA(
  masks: MPMask[] | undefined,
  scratch: { combined: Float32Array | null },
): { w: number; h: number; data: Uint8ClampedArray } | null {
  if (!masks || !masks.length) return null;
  const w = masks[0].width;
  const h = masks[0].height;
  if (!scratch.combined || scratch.combined.length !== w * h) scratch.combined = new Float32Array(w * h);
  const comb = scratch.combined;
  comb.fill(0);
  for (const m of masks) {
    if (m.width !== w || m.height !== h) continue;
    const f = m.getAsFloat32Array();
    for (let i = 0; i < f.length; i++) if (f[i] > comb[i]) comb[i] = f[i];
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 3; i < comb.length; i++, j += 4) {
    const v = (comb[i] - 0.25) * 2.2;
    data[j] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
  }
  return { w, h, data };
}
