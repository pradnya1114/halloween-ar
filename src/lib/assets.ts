/**
 * Ghost asset management.
 *  - Built-in collection: every PNG placed in src/assets/ghosts/ is picked up
 *    automatically at build time (import.meta.glob) – no code changes needed.
 *  - Uploaded collections: PNGs uploaded (files or whole folders) through the
 *    admin panel are stored in IndexedDB and restored on every start.
 */

export interface GhostAsset {
  id: string;
  name: string;
  collection: string;
  url: string;
  img: HTMLImageElement;
  builtIn: boolean;
  hasAlpha: boolean;
  aspect: number; // width / height
}

interface StoredAsset {
  id: string;
  name: string;
  collection: string;
  blob: Blob;
  createdAt: number;
}

export const BUILTIN_COLLECTION = "Built-in";

const builtInUrls = import.meta.glob("../assets/ghosts/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/* ---------------- IndexedDB ---------------- */

const DB_NAME = "halloween-ar";
const STORE = "ghosts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    let result: T | undefined;
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

/* ---------------- image helpers ---------------- */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${url.slice(0, 60)}`));
    img.src = url;
  });
}

/** Detects whether the image actually contains transparent pixels. */
function detectAlpha(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement("canvas");
    const w = (c.width = Math.min(96, img.naturalWidth));
    const h = (c.height = Math.max(1, Math.round((w / img.naturalWidth) * img.naturalHeight)));
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 245) transparent++;
    return transparent / (w * h) > 0.02;
  } catch {
    return true;
  }
}

async function toAsset(
  id: string,
  name: string,
  collection: string,
  url: string,
  builtIn: boolean,
): Promise<GhostAsset | null> {
  try {
    const img = await loadImage(url);
    return {
      id,
      name,
      collection,
      url,
      img,
      builtIn,
      hasAlpha: detectAlpha(img),
      aspect: img.naturalWidth / Math.max(1, img.naturalHeight),
    };
  } catch (e) {
    console.warn(e);
    return null;
  }
}

/* ---------------- public API ---------------- */

export async function loadAllAssets(): Promise<GhostAsset[]> {
  const builtIns = await Promise.all(
    Object.entries(builtInUrls).map(([path, url]) => {
      const file = path.split("/").pop()!.replace(/\.png$/i, "");
      return toAsset(`builtin:${file}`, file.replace(/[_-]+/g, " "), BUILTIN_COLLECTION, url, true);
    }),
  );
  let stored: StoredAsset[] = [];
  try {
    stored = ((await tx<StoredAsset[]>("readonly", (s) => s.getAll() as IDBRequest<StoredAsset[]>)) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  } catch (e) {
    console.warn("IndexedDB unavailable", e);
  }
  const uploaded = await Promise.all(
    stored.map((s) => toAsset(s.id, s.name, s.collection, URL.createObjectURL(s.blob), false)),
  );
  return [...builtIns, ...uploaded].filter((a): a is GhostAsset => !!a);
}

const isPng = (f: File) => f.type === "image/png" || /\.png$/i.test(f.name);

/** Store uploaded PNG files. Folder uploads use the folder name as collection. */
export async function addUploadedFiles(files: File[], fallbackCollection = "Uploaded"): Promise<GhostAsset[]> {
  const pngs = files.filter(isPng);
  const created: GhostAsset[] = [];
  for (const f of pngs) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    const collection = rel && rel.includes("/") ? rel.split("/").slice(-2, -1)[0] : fallbackCollection;
    const rec: StoredAsset = {
      id: `up:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      name: f.name.replace(/\.png$/i, ""),
      collection,
      blob: f,
      createdAt: Date.now(),
    };
    await tx("readwrite", (s) => s.put(rec));
    const a = await toAsset(rec.id, rec.name, rec.collection, URL.createObjectURL(f), false);
    if (a) created.push(a);
  }
  return created;
}

export async function deleteUploaded(id: string) {
  await tx("readwrite", (s) => s.delete(id));
}

export function collectionsOf(assets: GhostAsset[]): string[] {
  return Array.from(new Set(assets.map((a) => a.collection)));
}

export function activeAssets(
  assets: GhostAsset[],
  collection: string,
  enabled: Record<string, boolean>,
): GhostAsset[] {
  return assets.filter((a) => (collection === "all" || a.collection === collection) && enabled[a.id] !== false);
}
