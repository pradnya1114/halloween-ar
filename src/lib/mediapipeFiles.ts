/**
 * Resolve a real MediaPipe WasmFileset.
 *
 * Vite's SPA fallback returns index.html (bytes `<!do…`) for missing files.
 * Instantiating that as WebAssembly produces:
 *   CompileError: expected magic word 00 61 73 6d, found 3c 21 64 6f
 * so we MUST check the WASM magic bytes before handing a URL to MediaPipe.
 */

export interface MpFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}

export const MP_VERSION = "1.2.0";

const CDN_WASM_BASES = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}/wasm`,
];

export const CDN_MODEL = (m: string) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;

const CDN_FACE =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d]; // \0asm

function pageBase(): string {
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  try {
    return self.location.href;
  } catch {
    return "http://localhost/";
  }
}

export function absUrl(path: string): string {
  return new URL(path, pageBase()).href;
}

/** True iff `url` is an actual WebAssembly binary, not an HTML fallback page. */
export async function isRealWasm(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-31" }, cache: "no-store" });
    if (!r.ok && r.status !== 206) return false;
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("text/css") || ct.includes("javascript")) return false;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length >= 4 && WASM_MAGIC.every((b, i) => buf[i] === b)) return true;
    if (buf[0] === 0x3c) return false; // '<' → HTML
    const len = Number(r.headers.get("content-length") ?? "0");
    return len > 1_000_000;
  } catch {
    return false;
  }
}

async function isProbablyJs(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-31" }, cache: "no-store" });
    if (!r.ok && r.status !== 206) return false;
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("text/html")) return false;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x3c) return false; // HTML
    return buf.length > 8;
  } catch {
    return false;
  }
}

/** Cheap WASM SIMD probe (same bytes MediaPipe uses). */
export function hasSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

export async function resolveFileset(): Promise<{ fileset: MpFileset; source: string; variant: string }> {
  const variants = hasSimd() ? ["vision_wasm_internal", "vision_wasm_nosimd_internal"] : ["vision_wasm_nosimd_internal"];
  const bases: { base: string; source: string }[] = [
    { base: absUrl("mediapipe/wasm"), source: "local files" },
    ...CDN_WASM_BASES.map((base) => ({ base, source: "CDN" })),
  ];

  for (const variant of variants) {
    for (const { base, source } of bases) {
      const wasmBinaryPath = `${base.replace(/\/$/, "")}/${variant}.wasm`;
      const wasmLoaderPath = `${base.replace(/\/$/, "")}/${variant}.js`;
      if (!(await isRealWasm(wasmBinaryPath))) continue;
      if (!(await isProbablyJs(wasmLoaderPath))) continue;
      return { fileset: { wasmLoaderPath, wasmBinaryPath }, source, variant };
    }
  }

  throw new Error(
    "Could not load the person-detection engine. The .wasm file was missing (the server sent a web page instead) and the backup download failed. From the project folder run `npm run dev` so /mediapipe/wasm/*.wasm is served, or check your network.",
  );
}

export async function fetchModel(model: string): Promise<{ buf: ArrayBuffer; local: boolean }> {
  const local = absUrl(`models/pose_landmarker_${model}.task`);
  try {
    const r = await fetch(local);
    const ct = r.headers.get("content-type") ?? "";
    if (r.ok && !ct.includes("text/html")) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 1_000_000) return { buf, local: true };
    }
  } catch {
    /* CDN */
  }
  const r = await fetch(CDN_MODEL(model));
  if (!r.ok) throw new Error(`Model download failed (${r.status}). Check your network.`);
  return { buf: await r.arrayBuffer(), local: false };
}

export async function fetchFaceModel(): Promise<ArrayBuffer | null> {
  const local = absUrl("models/face_landmarker.task");
  try {
    const r = await fetch(local);
    const ct = r.headers.get("content-type") ?? "";
    if (r.ok && !ct.includes("text/html")) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 500_000) return buf;
    }
  } catch {
    /* CDN */
  }
  try {
    const r = await fetch(CDN_FACE);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return buf.byteLength > 500_000 ? buf : null;
  } catch {
    return null;
  }
}

export function friendlyDetectorError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/magic word|CompileError|WebAssembly|3c 21 64 6f/i.test(m)) {
    return "Person detection failed to load (the app got a web page instead of the engine file). Press Retry — a backup copy will be downloaded.";
  }
  return m.startsWith("Could not load") || m.startsWith("Model download") ? m : `Detector failed to load: ${m}`;
}
