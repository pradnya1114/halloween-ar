/// <reference lib="webworker" />
/**
 * Inference runs here, off the main thread, so the render loop stays at
 * 60 fps even when the model is slow (CPU fallback, weak GPU...).
 *
 * Face mode (default): only FaceLandmarker runs — landmarks, blendshapes
 * (blink / jaw / brows / smile) and head transformation matrix (yaw/pitch/roll).
 * Body mode: PoseLandmarker runs as well (optional).
 */
import { FaceLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { exprFromBlendshapes, headFromMatrix, type FaceDetection } from "./faceTypes";
import { buildMaskRGBA } from "./maskUtil";

declare const self: DedicatedWorkerGlobalScope;

let poseLm: PoseLandmarker | null = null;
let faceLm: FaceLandmarker | null = null;
let lastTs = -1;
let wantPose = false;

type P = { x: number; y: number; z: number; visibility?: number };
const scratch = { combined: null as Float32Array | null };

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      const fileset = msg.fileset as { wasmLoaderPath: string; wasmBinaryPath: string };
      wantPose = !!msg.opts.bodyTracking;
      const faceBuf = msg.faceModel as ArrayBuffer | null | undefined;
      const poseBuf = msg.model as ArrayBuffer | null | undefined;
      let delegate: "GPU" | "CPU" = "GPU";

      faceLm?.close();
      faceLm = null;
      poseLm?.close();
      poseLm = null;
      lastTs = -1;

      if (!faceBuf || faceBuf.byteLength < 500_000) throw new Error("face_landmarker.task missing — run `npm run setup`");
      const makeFace = (d: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: new Uint8Array(faceBuf), delegate: d },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          numFaces: Math.min(8, Math.max(1, msg.opts.maxPeople || 4)),
          minFaceDetectionConfidence: msg.opts.confidence ?? 0.5,
          minFacePresenceConfidence: msg.opts.confidence ?? 0.5,
          minTrackingConfidence: 0.6,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      try {
        faceLm = await makeFace("GPU");
      } catch {
        delegate = "CPU";
        faceLm = await makeFace("CPU");
      }

      if (wantPose && poseBuf && poseBuf.byteLength > 1_000_000) {
        const buf = new Uint8Array(poseBuf);
        const makePose = (d: "GPU" | "CPU") =>
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetBuffer: buf, delegate: d },
            canvas: new OffscreenCanvas(1, 1),
            runningMode: "VIDEO",
            numPoses: Math.max(1, msg.opts.maxPeople || 4),
            minPoseDetectionConfidence: msg.opts.confidence,
            minPosePresenceConfidence: msg.opts.confidence,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: !!msg.opts.masks,
          });
        try {
          poseLm = await makePose(delegate);
        } catch {
          try {
            poseLm = await makePose("CPU");
          } catch (err) {
            console.warn("Pose landmarker unavailable", err);
            poseLm = null;
          }
        }
      }
      self.postMessage({ type: "ready", delegate, pose: !!poseLm });
    } catch (err) {
      self.postMessage({ type: "error", message: (err as Error)?.message ?? String(err) });
    }
    return;
  }

  if (msg.type === "detect") {
    const bmp = msg.bitmap as ImageBitmap;
    if (!faceLm) {
      bmp.close();
      self.postMessage({ type: "result", id: msg.id, poses: [], faces: [], mask: null, ms: 0 });
      return;
    }
    const ts = Math.max(msg.ts, lastTs + 1);
    lastTs = ts;
    const t0 = performance.now();
    let poses: P[][] = [];
    let faces: FaceDetection[] = [];
    let mask: { w: number; h: number; data: Uint8ClampedArray } | null = null;
    try {
      const fr = faceLm.detectForVideo(bmp, ts);
      const lms = fr.faceLandmarks ?? [];
      faces = lms.map((pts, i) => ({
        landmarks: pts.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })),
        expr: exprFromBlendshapes(fr.faceBlendshapes?.[i]?.categories),
        head: headFromMatrix(fr.facialTransformationMatrixes?.[i]?.data),
      }));
      if (poseLm) {
        lastTs = ts + 1;
        poseLm.detectForVideo(bmp, ts + 1, (res) => {
          poses = res.landmarks.map((p) => p.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })));
          mask = buildMaskRGBA(res.segmentationMasks, scratch);
        });
      }
    } catch (err) {
      self.postMessage({ type: "error", message: (err as Error)?.message ?? String(err) });
    }
    bmp.close();
    const m = mask as { w: number; h: number; data: Uint8ClampedArray } | null;
    self.postMessage({ type: "result", id: msg.id, poses, faces, mask: m, ms: performance.now() - t0 }, m ? [m.data.buffer] : []);
  }
};
