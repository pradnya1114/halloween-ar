import { useRef, useState } from "react";
import { ENTRANCES, EXITS, FACE_FILTERS, type FaceFilter, type FxSettings, type Settings } from "../config/settings";
import { activeAssets, collectionsOf, type GhostAsset } from "../lib/assets";
import type { CameraDevice } from "../lib/camera";
import type { DetectorStatus } from "../lib/detector";
import type { EngineStats } from "../engine/Engine";
import { Btn, Section, Select, Slider, Toggle } from "./controls";

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  assets: GhostAsset[];
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (id: string) => void;
  cameras: CameraDevice[];
  camError: string | null;
  onRetryCamera: () => void;
  detStatus: DetectorStatus;
  stats: EngineStats | null;
  audioUnlocked: boolean;
  onTestSound: () => void;
  onFullscreen: () => void;
  onReset: () => void;
  onClose: () => void;
}

const FX_LABELS: { key: keyof FxSettings; label: string }[] = [
  { key: "grading", label: "Dark cinematic grading" },
  { key: "fog", label: "Fog & drifting smoke" },
  { key: "vignette", label: "Screen-edge vignette" },
  { key: "flicker", label: "Supernatural light flicker" },
  { key: "redFlashes", label: "Red flashes" },
  { key: "bats", label: "Bats" },
  { key: "crows", label: "Black crows" },
  { key: "silhouettes", label: "Background ghost silhouettes" },
  { key: "glitch", label: "Glitch & distortion" },
];

export default function AdminPanel(p: Props) {
  const { settings: s, update } = p;
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const collections = collectionsOf(p.assets);
  const visible = p.assets.filter((a) => s.activeCollection === "all" || a.collection === s.activeCollection);
  const activeCount = activeAssets(p.assets, s.activeCollection, s.assetEnabled).length;

  const upload = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      await p.onUpload(Array.from(files));
    } finally {
      setBusy(false);
    }
  };
  const setFx = (key: keyof FxSettings, v: boolean) => update({ fx: { ...s.fx, [key]: v } });

  return (
    <aside
      className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-red-900/40 bg-neutral-950/92 text-white shadow-2xl backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-wide text-red-400">☠ Haunt Control</h2>
          <p className="text-[11px] text-white/45">Keys: S settings · F fullscreen · M mute · D debug</p>
        </div>
        <Btn onClick={p.onClose}>Close ✕</Btn>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10">
        {/* Status */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <Stat label="People" value={p.stats?.people ?? 0} />
          <Stat label="Ghosts" value={p.stats?.ghosts ?? 0} />
          <Stat label="FPS" value={`${p.stats?.fps ?? 0}/${p.stats?.detectFps ?? 0}`} />
        </div>
        <div
          className={`mt-2 rounded-md px-3 py-2 text-xs ${
            p.detStatus.state === "error" ? "bg-red-950 text-red-200" : p.detStatus.state === "ready" ? "bg-emerald-950/60 text-emerald-200" : "bg-amber-950/60 text-amber-200"
          }`}
        >
          {p.detStatus.message}
          {p.stats && p.detStatus.state === "ready" && <span className="ml-1 text-white/50">· {p.stats.inferenceMs} ms/frame</span>}
        </div>
        {p.camError && (
          <div className="mt-2 rounded-md bg-red-950 px-3 py-2 text-xs text-red-200">
            {p.camError} <button className="ml-1 underline" onClick={p.onRetryCamera}>Retry</button>
          </div>
        )}

        <Section title="Display & Camera">
          <Select
            label="Camera"
            value={s.cameraId ?? ""}
            options={[{ value: "", label: "Default camera" }, ...p.cameras.map((c) => ({ value: c.deviceId, label: c.label }))]}
            onChange={(v) => update({ cameraId: v || null })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Resolution"
              value={s.resolution}
              options={[
                { value: "480p", label: "640×480" },
                { value: "720p", label: "1280×720" },
                { value: "1080p", label: "1920×1080" },
              ]}
              onChange={(v) => update({ resolution: v })}
            />
            <Select
              label="Camera rotation"
              value={s.rotation}
              options={[
                { value: 0, label: "0°" },
                { value: 90, label: "90° (camera on side)" },
                { value: 180, label: "180°" },
                { value: 270, label: "270°" },
              ]}
              onChange={(v) => update({ rotation: v })}
            />
          </div>
          <Toggle label="Mirror mode" checked={s.mirror} onChange={(v) => update({ mirror: v })} />
          <div className="flex flex-wrap gap-2">
            <Btn onClick={p.onFullscreen}>⛶ Fullscreen</Btn>
            <Btn onClick={p.onRetryCamera}>↻ Restart camera</Btn>
          </div>
          {p.stats && (
            <p className="text-[11px] text-white/45">
              Live feed: {p.stats.videoW}×{p.stats.videoH}
            </p>
          )}
        </Section>

        <Section title="Face tracking" defaultOpen={false}>
          <p className="text-[11px] text-white/45">
            Face-only by default: eye blink, mouth open/close, brows and head movement (yaw / pitch / roll). No body model is loaded.
          </p>
          <Slider label="Max faces" value={s.maxPeople} min={1} max={6} step={1} onChange={(v) => update({ maxPeople: v })} />
          <Slider label="Detection confidence" value={s.detectionConfidence} min={0.2} max={0.9} step={0.05} onChange={(v) => update({ detectionConfidence: v })} format={(v) => v.toFixed(2)} />
          <Slider label="Detection rate (fps)" value={s.detectFps} min={8} max={30} step={1} onChange={(v) => update({ detectFps: v })} />
          <Slider label="Frames to confirm a face" value={s.confirmFrames} min={1} max={12} step={1} onChange={(v) => update({ confirmFrames: v })} />
          <Slider label="Leave timeout" value={s.lostTimeoutMs} min={200} max={3000} step={50} onChange={(v) => update({ lostTimeoutMs: v })} format={(v) => `${v} ms`} />
          <p className="pt-1 text-[11px] text-white/45">Expression effects</p>
          <Toggle label="Eye blink" hint="Eyelids close on the mask when you blink" checked={s.exprBlink} onChange={(v) => update({ exprBlink: v })} />
          <Toggle label="Mouth / brows" hint="Open mouth → fangs, dark cavity, fire roar; brows → wide eyes" checked={s.exprMouth} onChange={(v) => update({ exprMouth: v })} />
          <Toggle label="Head movement" hint="Horns parallax, eyes glance, side shadow when you turn" checked={s.exprHead} onChange={(v) => update({ exprHead: v })} />
          <Toggle label="Debug overlay" hint="Face mesh + live blink / mouth / head readouts" checked={s.showDebug} onChange={(v) => update({ showDebug: v })} />
          <details className="pt-2">
            <summary className="cursor-pointer text-[11px] text-white/45">Advanced: body tracking (optional)</summary>
            <div className="mt-2 space-y-3">
              <Toggle
                label="Also track body"
                hint="Loads the heavier pose model. Only needed for full-body ghosts / occlusion."
                checked={s.bodyTracking}
                onChange={(v) => update({ bodyTracking: v })}
              />
              {s.bodyTracking && (
                <>
                  <Select
                    label="Body model"
                    value={s.model}
                    options={[
                      { value: "lite", label: "Pose Lite (fastest)" },
                      { value: "full", label: "Pose Full (more accurate)" },
                    ]}
                    onChange={(v) => update({ model: v })}
                  />
                  <Toggle label="Ghosts hide behind people" hint="Uses person segmentation masks for depth" checked={s.occlusion} onChange={(v) => update({ occlusion: v })} />
                </>
              )}
            </div>
          </details>
        </Section>

        <Section title="Face mask">
          <p className="text-[11px] text-white/45">Snapchat-style horror makeup that tracks your face. Ghosts stay behind you.</p>
          <div className="flex flex-wrap gap-2">
            {FACE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => update({ faceFilter: f.id as FaceFilter })}
                className={`rounded-full px-3 py-1.5 text-sm ${s.faceFilter === f.id ? "bg-red-600 text-white" : "bg-white/10 text-white/80"}`}
              >
                {f.emoji} {f.label}
              </button>
            ))}
          </div>
          <Slider label="Mask strength" value={s.faceMaskStrength} min={0} max={1} onChange={(v) => update({ faceMaskStrength: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Apply mask after person is seen" value={s.maskDelaySec} min={0} max={8} step={0.5} onChange={(v) => update({ maskDelaySec: v })} format={(v) => `${v.toFixed(1)} s`} />
          <Toggle label="Half face (vertical split)" hint="Mask only the left or right side of the face" checked={s.halfFace} onChange={(v) => update({ halfFace: v })} />
          {s.halfFace && (
            <Select
              label="Half-face side"
              value={s.halfFaceSide}
              options={[
                { value: "left", label: "Left half" },
                { value: "right", label: "Right half" },
              ]}
              onChange={(v) => update({ halfFaceSide: v })}
            />
          )}
          <p className="pt-1 text-[11px] text-white/45">Devil horns</p>
          <Slider label="Horn size" value={s.hornSize} min={0.4} max={1.8} onChange={(v) => update({ hornSize: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Horn height (up / down)" value={s.hornHeight} min={-0.45} max={0.35} onChange={(v) => update({ hornHeight: v })} format={(v) => v.toFixed(2)} />
          <Slider label="Horn spread" value={s.hornSpread} min={0.55} max={1.7} onChange={(v) => update({ hornSpread: v })} format={(v) => v.toFixed(2)} />
          <Toggle label="Fire on horns" checked={s.hornFire} onChange={(v) => update({ hornFire: v })} />
        </Section>

        <Section title="Ghost behaviour">
          <Slider label="Ghosts per person" value={s.ghostsPerPerson} min={1} max={9} step={1} onChange={(v) => update({ ghostsPerPerson: v })} />
          <Slider label="Size" value={s.ghostSize} min={0.25} max={1.4} onChange={(v) => update({ ghostSize: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Opacity" value={s.ghostOpacity} min={0.1} max={1} onChange={(v) => update({ ghostOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Animation speed" value={s.animSpeed} min={0.25} max={2.5} onChange={(v) => update({ animSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Delay before first ghost" value={s.spawnDelay} min={0} max={5} step={0.1} onChange={(v) => update({ spawnDelay: v })} format={(v) => `${v.toFixed(1)} s`} />
          <Slider label="Spawn interval (frequency)" value={s.spawnInterval} min={0.1} max={5} step={0.1} onChange={(v) => update({ spawnInterval: v })} format={(v) => `${v.toFixed(1)} s`} />
          <Toggle label="Cycle ghosts" hint="Ghosts periodically leave and new ones arrive" checked={s.cycleGhosts} onChange={(v) => update({ cycleGhosts: v })} />
          {s.cycleGhosts && <Slider label="Ghost lifetime" value={s.cycleSeconds} min={4} max={60} step={1} onChange={(v) => update({ cycleSeconds: v })} format={(v) => `${v} s`} />}
        </Section>

        <Section title="Animations" defaultOpen={false}>
          <p className="text-[11px] text-white/45">Entrance animations</p>
          {ENTRANCES.map((e) => (
            <Toggle key={e.id} label={e.label} checked={s.entrances[e.id]} onChange={(v) => update({ entrances: { ...s.entrances, [e.id]: v } })} />
          ))}
          <p className="pt-2 text-[11px] text-white/45">Exit animations (when a person leaves)</p>
          {EXITS.map((e) => (
            <Toggle key={e.id} label={e.label} checked={s.exits[e.id]} onChange={(v) => update({ exits: { ...s.exits, [e.id]: v } })} />
          ))}
        </Section>

        <Section title={`Ghost images (${activeCount} active)`}>
          <Select
            label="Asset collection"
            value={s.activeCollection}
            options={[{ value: "all", label: "All collections" }, ...collections.map((c) => ({ value: c, label: c }))]}
            onChange={(v) => update({ activeCollection: v })}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              upload(e.dataTransfer.files);
            }}
            className={`rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors ${drag ? "border-red-500 bg-red-950/40" : "border-white/15"}`}
          >
            <p className="mb-2 text-white/60">{busy ? "Uploading…" : "Drop transparent PNG ghosts here"}</p>
            <div className="flex justify-center gap-2">
              <Btn variant="primary" onClick={() => fileRef.current?.click()}>
                + PNG files
              </Btn>
              <Btn onClick={() => folderRef.current?.click()}>+ Folder</Btn>
            </div>
            <input ref={fileRef} type="file" accept="image/png" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ""))} />
            <input
              ref={(el) => {
                folderRef.current = el;
                if (el) el.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              hidden
              onChange={(e) => (upload(e.target.files), (e.target.value = ""))}
            />
            <p className="mt-2 text-[10px] text-white/35">Folder uploads become their own collection. Images are stored locally in this browser.</p>
          </div>
          {activeCount === 0 && <p className="rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200">No ghost images enabled — enable at least one.</p>}
          <div className="grid grid-cols-3 gap-2">
            {visible.map((a) => {
              const on = s.assetEnabled[a.id] !== false;
              const sc = s.assetScale[a.id] ?? 1;
              return (
                <div key={a.id} className={`group relative rounded-md border p-1 ${on ? "border-red-500/60 bg-white/5" : "border-white/10 opacity-50"}`}>
                  <button
                    type="button"
                    title={on ? "Click to disable" : "Click to enable"}
                    onClick={() => update({ assetEnabled: { ...s.assetEnabled, [a.id]: !on } })}
                    className="checker block aspect-square w-full overflow-hidden rounded"
                  >
                    <img src={a.url} alt={a.name} className="h-full w-full object-contain" />
                  </button>
                  <div className="mt-1 truncate text-[10px] text-white/70" title={`${a.name} · ${a.collection}`}>
                    {on ? "✓ " : "○ "}
                    {a.name}
                  </div>
                  {!a.hasAlpha && <div className="text-[9px] text-amber-300">no transparency</div>}
                  <input
                    type="range"
                    min={0.4}
                    max={2}
                    step={0.05}
                    value={sc}
                    title={`Scale ${Math.round(sc * 100)}%`}
                    onChange={(e) => update({ assetScale: { ...s.assetScale, [a.id]: Number(e.target.value) } })}
                    className="w-full accent-red-500"
                  />
                  {!a.builtIn && (
                    <button
                      type="button"
                      onClick={() => p.onDelete(a.id)}
                      className="absolute right-1 top-1 hidden h-5 w-5 rounded-full bg-black/80 text-[10px] text-red-300 group-hover:block"
                      title="Delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Btn onClick={() => update({ assetEnabled: Object.fromEntries(visible.map((a) => [a.id, true])) })}>Enable all</Btn>
            <Btn onClick={() => update({ assetEnabled: { ...s.assetEnabled, ...Object.fromEntries(visible.map((a) => [a.id, false])) } })}>Disable all</Btn>
          </div>
        </Section>

        <Section title="Horror effects" defaultOpen={false}>
          {FX_LABELS.map((f) => (
            <Toggle key={f.key} label={f.label} checked={s.fx[f.key]} onChange={(v) => setFx(f.key, v)} />
          ))}
          <Slider label="Fog density" value={s.fogDensity} min={0} max={1} onChange={(v) => update({ fogDensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Effect intensity" value={s.effectIntensity} min={0} max={1} onChange={(v) => update({ effectIntensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Section>

        <Section title="Sound" defaultOpen={false}>
          <Toggle label="Horror sound effects" checked={s.sound} onChange={(v) => update({ sound: v })} />
          <Toggle label="Mute" checked={s.muted} onChange={(v) => update({ muted: v })} />
          <Slider label="Volume" value={s.volume} min={0} max={1} onChange={(v) => update({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
          {!p.audioUnlocked && <p className="text-[11px] text-amber-300">Audio starts after the first click/tap/key press (browser policy).</p>}
          <Btn onClick={p.onTestSound}>▶ Test sound</Btn>
        </Section>

        <div className="mt-4 flex justify-between">
          <Btn variant="danger" onClick={p.onReset}>
            Reset settings
          </Btn>
          <Btn variant="primary" onClick={p.onClose}>
            Done
          </Btn>
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-white/5 px-2 py-2">
      <div className="font-mono text-lg text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
    </div>
  );
}
