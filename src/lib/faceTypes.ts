import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Facial expression signals, 0..1 (from MediaPipe blendshapes). */
export interface FaceExpr {
  blinkL: number;
  blinkR: number;
  jawOpen: number;
  smile: number;
  browUp: number;
  browDown: number;
  mouthPucker: number;
  eyeWideL: number;
  eyeWideR: number;
}

/** Head rotation in radians (from the facial transformation matrix). */
export interface HeadPose {
  yaw: number; // left(-) / right(+)
  pitch: number; // up(-) / down(+)
  roll: number; // tilt
}

export interface FaceDetection {
  landmarks: NormalizedLandmark[];
  expr: FaceExpr;
  head: HeadPose;
}

export const ZERO_EXPR: FaceExpr = {
  blinkL: 0,
  blinkR: 0,
  jawOpen: 0,
  smile: 0,
  browUp: 0,
  browDown: 0,
  mouthPucker: 0,
  eyeWideL: 0,
  eyeWideR: 0,
};

export const ZERO_HEAD: HeadPose = { yaw: 0, pitch: 0, roll: 0 };

/** Pull named categories out of a MediaPipe blendshape classification. */
export function exprFromBlendshapes(cats: { categoryName: string; score: number }[] | undefined): FaceExpr {
  if (!cats) return { ...ZERO_EXPR };
  const m = new Map<string, number>();
  for (const c of cats) m.set(c.categoryName, c.score);
  const g = (k: string) => m.get(k) ?? 0;
  return {
    blinkL: g("eyeBlinkLeft"),
    blinkR: g("eyeBlinkRight"),
    jawOpen: g("jawOpen"),
    smile: (g("mouthSmileLeft") + g("mouthSmileRight")) / 2,
    browUp: (g("browInnerUp") + g("browOuterUpLeft") + g("browOuterUpRight")) / 3,
    browDown: (g("browDownLeft") + g("browDownRight")) / 2,
    mouthPucker: g("mouthPucker"),
    eyeWideL: g("eyeWideLeft"),
    eyeWideR: g("eyeWideRight"),
  };
}

/** Euler angles from a 4x4 column-major transformation matrix. */
export function headFromMatrix(data: ArrayLike<number> | undefined): HeadPose {
  if (!data || data.length < 16) return { ...ZERO_HEAD };
  // column-major: m[col*4 + row]
  const r00 = data[0],
    r10 = data[1],
    r20 = data[2];
  const r21 = data[6];
  const r22 = data[10];
  const pitch = Math.atan2(r21, r22);
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22));
  const roll = Math.atan2(r10, r00);
  return { yaw, pitch, roll };
}
