import { FaceLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { exprFromBlendshapes, headFromMatrix, type FaceDetection } from "./faceTypes";
import { fetchFaceModel, fetchModel, friendlyDetectorError, resolveFileset, type MpFileset } from "./mediapipeFiles";
import DetectorWorker from "./detector.worker.ts?worker&inline";

export interface DetectorOptions {
  model: "lite" | "full";
  maxPeople: number;
  confidence: number;
  masks: boolean;
  /** Load the (heavy) body model too. Off = face-only. */
  bodyTracking: boolean;
}

export interface DetectionFrame {
  poses: NormalizedLandmark[][];
  faces: FaceDetection[];
  /** canvas (rotated-frame space) whose alpha = union of person silhouettes (body mode only) */
  mask: HTMLCanvasElement | null;
  inferenceMs: number;
}

export type DetectorStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; message: string; delegate: string; source: string }
  | { state: "error"; message: string };

type ResultHandler = (frame: DetectionFrame, captureTs: number) => void;

export class PersonDetector {
  private worker: Worker | null = null;
  private mainFace: FaceLandmarker | null = null;
  private opts: DetectorOptions | null = null;
  private maskCanvas = document.createElement("canvas");
  private maskCtx = this.maskCanvas.getContext("2d")!;
  private pending: { id: number; ts: number; sentAt: number } | null = null;
  private seq = 0;
  private lastTs = -1;
  private _ready = false;
  mode: "worker" | "main" | "" = "";
  delegate = "";
  hasPose = false;
  onResult: ResultHandler = () => {};

  get ready() {
    return this._ready;
  }

  get busy() {
    if (this.pending && performance.now() - this.pending.sentAt > 5000) this.pending = null;
    return !!this.pending;
  }

  sameOptions(o: DetectorOptions) {
    const c = this.opts;
    return (
      !!c &&
      c.model === o.model &&
      c.maxPeople === o.maxPeople &&
      c.confidence === o.confidence &&
      c.masks === o.masks &&
      c.bodyTracking === o.bodyTracking
    );
  }

  async init(o: DetectorOptions, onStatus: (s: DetectorStatus) => void): Promise<void> {
    this._ready = false;
    onStatus({ state: "loading", message: o.bodyTracking ? "Loading face + body models…" : "Loading face model…" });
    try {
      const [{ fileset, source: wasmSource }, faceBuf, pose] = await Promise.all([
        resolveFileset(),
        fetchFaceModel(),
        o.bodyTracking ? fetchModel(o.model) : Promise.resolve(null),
      ]);
      if (!faceBuf) throw new Error("face_landmarker.task could not be loaded — run `npm run setup` or check your network.");
      const local = wasmSource === "local files" && (!pose || pose.local);
      const source = local ? "local files" : "CDN fallback";
      try {
        await this.initWorker(fileset, faceBuf.slice(0), pose ? pose.buf.slice(0) : null, o);
        this.mode = "worker";
      } catch (e) {
        console.warn("Worker inference unavailable, using main thread", e);
        this.worker?.terminate();
        this.worker = null;
        await this.initMain(fileset, o);
        this.mode = "main";
        this.hasPose = false;
      }
      this.opts = { ...o };
      this.pending = null;
      this._ready = true;
      const what = this.hasPose ? "face + body" : "face only";
      onStatus({
        state: "ready",
        message: `Ready · ${what} · ${this.delegate} · ${this.mode === "worker" ? "web worker" : "main thread"} · ${source}`,
        delegate: this.delegate,
        source,
      });
    } catch (e) {
      onStatus({ state: "error", message: friendlyDetectorError(e) });
      throw e;
    }
  }

  private initWorker(fileset: MpFileset, faceModel: ArrayBuffer, poseModel: ArrayBuffer | null, o: DetectorOptions): Promise<void> {
    if (!this.worker) {
      this.worker = new DetectorWorker();
      this.worker.onmessage = (e) => this.onWorkerMessage(e.data);
    }
    const w = this.worker;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("worker init timeout")), 45000);
      const prev = w.onmessage;
      w.onmessage = (e) => {
        if (e.data.type === "ready") {
          window.clearTimeout(timer);
          this.delegate = e.data.delegate;
          this.hasPose = !!e.data.pose;
          w.onmessage = prev;
          resolve();
        } else if (e.data.type === "error") {
          window.clearTimeout(timer);
          w.onmessage = prev;
          reject(new Error(e.data.message));
        }
      };
      w.onerror = (ev) => {
        window.clearTimeout(timer);
        reject(new Error(ev.message || "worker error"));
      };
      const xfer: Transferable[] = [faceModel];
      if (poseModel) xfer.push(poseModel);
      w.postMessage({ type: "init", fileset, faceModel, model: poseModel, opts: o }, xfer);
    });
  }

  private async initMain(fileset: MpFileset, o: DetectorOptions) {
    const faceModel = await fetchFaceModel();
    if (!faceModel) throw new Error("face_landmarker.task could not be loaded for main-thread detection.");
    const faceBuf = new Uint8Array(faceModel.slice(0));
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: faceBuf.slice(0), delegate },
        runningMode: "VIDEO",
        numFaces: Math.min(8, Math.max(1, o.maxPeople)),
        minFaceDetectionConfidence: o.confidence,
        minFacePresenceConfidence: o.confidence,
        minTrackingConfidence: 0.6,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    let lm: FaceLandmarker;
    try {
      lm = await make("GPU");
      this.delegate = "GPU";
    } catch {
      lm = await make("CPU");
      this.delegate = "CPU";
    }
    this.mainFace?.close();
    this.mainFace = lm;
    this.lastTs = -1;
  }

  private maskToCanvas(m: { w: number; h: number; data: Uint8ClampedArray } | null): HTMLCanvasElement | null {
    if (!m) return null;
    if (this.maskCanvas.width !== m.w || this.maskCanvas.height !== m.h) {
      this.maskCanvas.width = m.w;
      this.maskCanvas.height = m.h;
    }
    this.maskCtx.putImageData(new ImageData(m.data as Uint8ClampedArray<ArrayBuffer>, m.w, m.h), 0, 0);
    return this.maskCanvas;
  }

  private onWorkerMessage(msg: {
    type: string;
    id?: number;
    poses?: NormalizedLandmark[][];
    faces?: FaceDetection[];
    mask?: { w: number; h: number; data: Uint8ClampedArray } | null;
    ms?: number;
    message?: string;
  }) {
    if (msg.type === "error") {
      console.warn("detector worker:", msg.message);
      this.pending = null;
      return;
    }
    if (msg.type !== "result" || !this.pending || msg.id !== this.pending.id) return;
    const ts = this.pending.ts;
    this.pending = null;
    this.onResult({ poses: msg.poses ?? [], faces: msg.faces ?? [], mask: this.maskToCanvas(msg.mask ?? null), inferenceMs: msg.ms ?? 0 }, ts);
  }

  /** Submit a frame. Returns false if the detector is not ready or still busy. */
  submit(source: HTMLCanvasElement, ts: number): boolean {
    if (!this._ready || this.busy) return false;
    if (this.mode === "worker" && this.worker) {
      const id = ++this.seq;
      this.pending = { id, ts, sentAt: performance.now() };
      const w = this.worker;
      createImageBitmap(source)
        .then((bitmap) => w.postMessage({ type: "detect", id, ts, bitmap }, [bitmap]))
        .catch(() => (this.pending = null));
      return true;
    }
    if (this.mainFace) {
      const t = Math.max(ts, this.lastTs + 1);
      this.lastTs = t;
      const t0 = performance.now();
      const fr = this.mainFace.detectForVideo(source, t);
      const faces: FaceDetection[] = (fr.faceLandmarks ?? []).map((pts, i) => ({
        landmarks: pts.slice(),
        expr: exprFromBlendshapes(fr.faceBlendshapes?.[i]?.categories),
        head: headFromMatrix(fr.facialTransformationMatrixes?.[i]?.data),
      }));
      this.onResult({ poses: [], faces, mask: null, inferenceMs: performance.now() - t0 }, ts);
      return true;
    }
    return false;
  }

  close() {
    this.worker?.terminate();
    this.worker = null;
    this.mainFace?.close();
    this.mainFace = null;
    this.opts = null;
    this._ready = false;
  }
}
