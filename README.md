# 👻 Haunted Mirror – Halloween Horror AR Live Camera

Portrait (1080×1920) fullscreen kiosk app. A live camera feed fills the screen; when people walk in,
**real on-device pose detection** finds them, gives each one a stable tracking ID, and summons an
independent group of animated transparent-PNG ghosts that float around their head, shoulders, waist and
legs. Some ghosts hide *behind* the person using segmentation masks. When someone leaves, only that
person's ghosts fly away, dissolve into smoke or flicker out.

Built with React + TypeScript + Vite + Tailwind, **MediaPipe Tasks Vision PoseLandmarker** (running in
a Web Worker), Canvas 2D layers and WebAudio.

---

## Quick start (after downloading the zip)

```bash
npm install          # also runs scripts/setup-assets.mjs automatically
npm run dev          # http://localhost:5173  (camera works on localhost or HTTPS)
npm run build        # production build -> dist/
npx vite preview     # serve dist/ on http://localhost:4173
```

Allow camera access when prompted. Press **S** to open the admin panel.

> **Downloaded zips do not include generated files** (WASM binaries, `.task` models, mask/ghost PNGs).
> `npm install` regenerates all of them via `scripts/setup-assets.mjs` — pure Node, no Python.
> If face masks, mouth-open fangs, or horns don't appear, run **`npm run setup`** once and restart.
> The script needs internet the **first** time only (to fetch the three models, ~19 MB); after that
> everything is fully offline. Confirm in the admin panel: the status line should say **"local files"**.

### What `npm run setup` creates

| Output | Purpose |
|---|---|
| `public/mediapipe/wasm/*.wasm` + `.js` | MediaPipe runtime (copied from `node_modules`) |
| `public/models/face_landmarker.task` | **face mesh — required for masks & mouth-open** |
| `public/models/pose_landmarker_{lite,full}.task` | body tracking |
| `public/masks/horns.png`, `wraith_skull.png` | transparent horn / skull overlays |
| `src/assets/masks/`, `src/assets/ghosts/` | same PNGs, bundled into the app |

### Locally hosted model & runtime (no cloud inference)

| File | Purpose |
|---|---|
| `public/models/pose_landmarker_lite.task` | default model (fast) |
| `public/models/pose_landmarker_full.task` | more accurate model |
| `public/mediapipe/wasm/*` | MediaPipe WASM runtime (copied from `node_modules/@mediapipe/tasks-vision/wasm`) |

These ship next to `dist/index.html`. **All inference runs in the browser on your device.** If the
local files can't be found (for example when only `index.html` is hosted), the app falls back to
downloading the same files once from the official CDN. The admin panel shows which source is in use
("local files" or "CDN fallback").

If you see `CompileError: expected magic word 00 61 73 6d, found 3c 21 64 6f`, the server sent a web
page instead of the `.wasm` file. From the project folder run:

```bash
npm run setup
npm run dev
```

Do **not** open `index.html` as a `file://` URL — the camera and the engine need `http://localhost`.

To refresh the runtime after upgrading the package, just run `npm run setup` again (delete the
files you want re-fetched first; the script only creates what is missing).

---

## Kiosk deployment (vertical TV)

1. Rotate the display to portrait in the OS (1080×1920).
2. Serve `dist/` from `localhost` or HTTPS (camera APIs require a secure context), e.g. `npx vite preview --port 4173`.
3. Launch Chrome/Edge in kiosk mode with permissions pre-granted and audio allowed:

```bash
google-chrome --kiosk --start-fullscreen \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  http://localhost:4173/
```

(`--use-fake-ui-for-media-stream` auto-accepts the camera prompt; it does **not** fake the video.)

* If the camera is mounted sideways to get a portrait image, set **Camera rotation** to 90°/270°.
* The screen wake-lock is requested automatically. A frozen or unplugged camera is restarted automatically.

### Admin access (no visible UI on the public screen)

| Action | How |
|---|---|
| Open/close settings | **S** key, or tap the top-right corner 5×, long-press it 1.5 s, or double-click it |
| Fullscreen | **F** |
| Mute / unmute | **M** |
| Debug skeletons + track IDs | **D** |

---

## Ghost images

* **Built-in collection:** every PNG in `src/assets/ghosts/` is picked up automatically at build
  time (`import.meta.glob`). Drop new files in and rebuild; no code changes needed.
* **Upload at runtime:** admin panel → *Ghost images* → **+ PNG files**, **+ Folder** or drag & drop.
  Uploads are stored in IndexedDB, so they survive restarts. A folder upload becomes its own
  *asset collection*, and choosing a collection loads all of its PNGs.
* Each image has a thumbnail (on a transparency checkerboard), an enable/disable toggle, a per-image
  scale slider and a delete button. Images without real transparency are flagged.
* Global controls: size, opacity, animation speed, first-ghost delay, spawn interval (frequency),
  ghosts per person, cycling and lifetime, plus which entrance and exit animations are enabled.
* All settings are saved to `localStorage`.

`scripts/make_transparent_ghosts.py` converts artwork rendered on pure black into transparent PNGs
(luminance → alpha, un-premultiplied colour): `python3 scripts/make_transparent_ghosts.py scripts/raw src/assets/ghosts`.

---

## How it works

```
camera ─► <video> (CSS colour grade, cover-fit, mirror/rotation)
   │
   └─► 640px rotated frame ─► Web Worker: PoseLandmarker (VIDEO mode, GPU→CPU fallback,
                                         numPoses = max people, segmentation masks)
                                   │
          landmarks + combined silhouette mask
                                   ▼
      PersonTracker: NMS de-dup → motion-predicted greedy matching (distance + IoU + size)
                     → tentative→confirmed after N frames → stable IDs → One-Euro smoothing
                     → removal only after several missed frames AND a timeout
                                   ▼
      GhostManager: one group per confirmed track, staggered spawns into body slots
                    (beside head, above head, behind shoulders, waist, legs), spring-follow,
                    idle float/sway/rotate/breathe/lunge, cycling, exits on departure
                                   ▼
      back canvas  (silhouettes + "behind" ghosts, person mask cut out with destination-out)
      front canvas (front ghosts, smoke/sparks/flash particles, bats & crows, fog, glitch, flicker)
      DOM layers   (soft-light blue grade, multiply red flash, vignette, film grain)
```

| Module | Responsibility |
|---|---|
| `src/lib/camera.ts` | getUserMedia, device list, error messages, fallback when the saved camera is missing |
| `src/lib/detector.ts` / `detector.worker.ts` | model loading (local → CDN), worker inference, main-thread fallback |
| `src/lib/tracker.ts` | body anchors from landmarks, multi-person tracking, One-Euro filter |
| `src/lib/geometry.ts` | cover-fit / rotation / mirror mapping between camera and stage |
| `src/lib/assets.ts` | built-in + IndexedDB ghost collections |
| `src/engine/ghosts.ts` | ghost groups, 5 entrances, idle motion, 3 exits |
| `src/engine/fx.ts` | fog, flicker, red flashes, glitch, bats/crows, background silhouettes |
| `src/engine/particles.ts`, `sprites.ts` | smoke/spark/flash particles, procedural sprites |
| `src/engine/audio.ts` | synthesized drone, wind, whispers, heartbeat, stingers, caws, thunder |
| `src/engine/Engine.ts` | main loop that ties it all together, plus the debug overlay |
| `src/components/AdminPanel.tsx` | settings UI |

**Animations:** rise from below · materialize through smoke (blur → sharp with puffs) · fly in from the
screen edge on a curve with motion echoes · emerge from behind the shoulder (occluded by the person) ·
teleport with flash, sparks and chromatic jitter · staggered multi-ghost arrival · float/sway/rotate/
drift/scale and occasional lunges · fly away, dissolve into smoke or flicker out on departure.

---

## Testing that was done

The production build was tested end to end in headless Chromium with a fake webcam fed from an MJPEG
clip of real people (`scripts/test/make_fake_camera.py`). This exercised the real `getUserMedia`
stream, the real model running in the worker, the tracker and the renderer. Verified:

* model loads from **local files** in a **web worker** (GPU delegate)
* empty frames → no ghosts; a person appears → tentative → confirmed with a stable ID → staggered ghosts
* the person leaves → that track is removed → only its ghosts run exit animations
* a person re-enters → a new ID and a new ghost group; no duplicate groups per frame
* the debug skeleton and bounding box line up exactly with the person on the 1080×1920 stage
* the render loop keeps running while inference is slow (inference is off the main thread)

## Known limitations

* **The sandbox has no physical camera or GPU.** Inference there took about 1.5 s per frame on
  software WebGL with 2 CPU cores, so the rendering seen in tests was much slower than real hardware.
  On a normal PC with a GPU, the lite model runs in roughly 15–30 ms per frame.
* **BlazePose has limited recall for secondary people** in crowded frames. The optional
  **Multi-person boost** (Person detection section) runs extra crop passes every 3rd frame on a CPU
  landmarker to find people the full-frame pass missed. It is **off by default**: it needs noticeably
  more memory and CPU, and it could not be verified as stable in the low-memory test sandbox. Try it
  on your kiosk PC; for best multi-person results, frame the camera so people appear full-body and
  not too small.
* A landscape webcam on a portrait screen is cover-cropped to the centre strip. For a wider view,
  mount the camera sideways and set **Camera rotation**.
* Browsers block audio until the first interaction unless Chrome is started with
  `--autoplay-policy=no-user-gesture-required`.
