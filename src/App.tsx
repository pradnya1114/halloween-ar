import { useCallback, useEffect, useRef, useState } from "react";
import AdminPanel from "./components/AdminPanel";

import { DEFAULT_SETTINGS, FACE_FILTERS, loadSettings, saveSettings, type FaceFilter, type Settings } from "./config/settings";
import { HorrorEngine, type EngineStats } from "./engine/Engine";
import { addUploadedFiles, deleteUploaded, loadAllAssets, type GhostAsset } from "./lib/assets";
import { describeCameraError, listCameras, openCamera, stopStream, type CameraDevice } from "./lib/camera";
import type { DetectorStatus } from "./lib/detector";
import { STAGE_H, STAGE_W } from "./lib/geometry";

function gradingFilter(s: Settings) {
  if (s.faceFilter === "skull") return "grayscale(1) contrast(1.25) brightness(0.78)";
  if (s.faceFilter === "wraith") return "saturate(0.25) contrast(1.2) brightness(0.58) hue-rotate(200deg)";
  if (s.faceFilter === "devil") return "saturate(1.25) contrast(1.15) brightness(0.78)";
  if (s.faceFilter === "vampire") return "grayscale(0.45) contrast(1.18) brightness(0.82) saturate(0.45)";
  if (!s.fx.grading) return "none";
  const i = s.effectIntensity;
  return `brightness(${1 - 0.3 * i}) contrast(${1 + 0.25 * i}) saturate(${1 - 0.55 * i}) sepia(${0.35 * i}) hue-rotate(${180 * Math.min(1, i * 1.4)}deg)`;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [assets, setAssets] = useState<GhostAsset[]>([]);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const [panelOpen, setPanelOpen] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [camLive, setCamLive] = useState(false);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [detStatus, setDetStatus] = useState<DetectorStatus>({ state: "loading", message: "Preparing person detection…" });
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [scale, setScale] = useState(1);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const redRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HorrorEngine | null>(null);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  /* ---------- persist settings ---------- */
  useEffect(() => {
    const t = window.setTimeout(() => saveSettings(settings), 300);
    return () => window.clearTimeout(t);
  }, [settings]);

  /* ---------- load ghost assets ---------- */
  useEffect(() => {
    loadAllAssets().then(setAssets);
  }, []);

  /* ---------- engine ---------- */
  useEffect(() => {
    const engine = new HorrorEngine(
      { video: videoRef.current!, back: backRef.current!, face: faceRef.current!, front: frontRef.current!, videoWrap: wrapRef.current!, redLayer: redRef.current! },
      () => settingsRef.current,
      () => assetsRef.current,
      (st) => {
        (window as unknown as { __hauntStats: EngineStats }).__hauntStats = st; // diagnostics hook
        if (panelOpenRef.current) setStats(st);
      },
      setDetStatus,
    );
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.ensureDetector();
  }, [settings.model, settings.maxPeople, settings.detectionConfidence, settings.occlusion, settings.bodyTracking]);

  /* ---------- camera ---------- */
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let retry = 0;
    const video = videoRef.current!;
    const start = async () => {
      try {
        setCamLive(false);
        stream = await openCamera(settingsRef.current.cameraId, settingsRef.current.resolution);
        if (cancelled) return stopStream(stream);
        video.srcObject = stream;
        await video.play().catch(() => {});
        setCamError(null);
        setCamLive(true);
        setCameras(await listCameras());
        stream.getVideoTracks().forEach((t) =>
          t.addEventListener("ended", () => {
            if (cancelled) return;
            setCamError("Camera disconnected – reconnecting…");
            retry = window.setTimeout(() => setCameraNonce((n) => n + 1), 2000);
          }),
        );
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setCamError(describeCameraError(err));
        setCameras(await listCameras().catch(() => []));
        // keep trying in kiosk mode (e.g. camera plugged in later)
        retry = window.setTimeout(() => setCameraNonce((n) => n + 1), 6000);
      }
    };
    start();
    const onDeviceChange = () => listCameras().then(setCameras);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      stopStream(stream);
      video.srcObject = null;
    };
  }, [settings.cameraId, settings.resolution, cameraNonce]);

  /* ---------- watchdog: restart a frozen camera ---------- */
  useEffect(() => {
    if (!camLive) return;
    let lastTime = -1;
    let stalls = 0;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      if (v.currentTime === lastTime) stalls++;
      else stalls = 0;
      lastTime = v.currentTime;
      if (stalls >= 3) {
        stalls = 0;
        setCameraNonce((n) => n + 1);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [camLive]);

  /* ---------- stage scaling ---------- */
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /* ---------- wake lock (keep the display on) ---------- */
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const req = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === "visible") lock = await wl.request("screen");
      } catch {
        /* not supported */
      }
    };
    req();
    document.addEventListener("visibilitychange", req);
    return () => {
      document.removeEventListener("visibilitychange", req);
      lock?.release().catch(() => {});
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  /* ---------- keyboard + audio unlock ---------- */
  useEffect(() => {
    const unlock = () => {
      engineRef.current?.audio.unlock();
      setTimeout(() => setAudioUnlocked(!!engineRef.current?.audio.unlocked), 300);
    };
    const onKey = (e: KeyboardEvent) => {
      unlock();
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "s" || (k === "escape" && panelOpenRef.current)) setPanelOpen((o) => !o);
      else if (k === "f") toggleFullscreen();
      else if (k === "m") setSettings((s) => ({ ...s, muted: !s.muted }));
      else if (k === "d") setSettings((s) => ({ ...s, showDebug: !s.showDebug }));
      else if (k >= "1" && k <= "5") {
        const id = FACE_FILTERS[Number(k) - 1]?.id as FaceFilter | undefined;
        if (id) setSettings((s) => ({ ...s, faceFilter: id }));
      }
      else if (k === "[" || k === "-") setSettings((s) => ({ ...s, ghostSize: Math.max(0.25, s.ghostSize - 0.05) }));
      else if (k === "]" || k === "=") setSettings((s) => ({ ...s, ghostSize: Math.min(1.4, s.ghostSize + 0.05) }));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlock);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlock);
    };
  }, [toggleFullscreen]);

  /* ---------- hidden admin hotspot (top-right corner): 5 taps or 1.5s long-press ---------- */
  const taps = useRef<number[]>([]);
  const pressTimer = useRef(0);
  const onHotspotDown = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setPanelOpen(true);
    }
    pressTimer.current = window.setTimeout(() => setPanelOpen(true), 1500);
  };
  const onHotspotUp = () => window.clearTimeout(pressTimer.current);

  /* ---------- asset handlers ---------- */
  const onUpload = async (files: File[]) => {
    const created = await addUploadedFiles(files);
    if (created.length) setAssets((a) => [...a, ...created]);
  };
  const onDelete = async (id: string) => {
    await deleteUploaded(id);
    setAssets((a) => {
      const gone = a.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return a.filter((x) => x.id !== id);
    });
  };

  const intensity = settings.effectIntensity;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ cursor: panelOpen ? "auto" : "none" }}>
      {/* 1080x1920 portrait stage, scaled to fit */}
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden bg-black"
        style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div ref={wrapRef} className="absolute inset-0">
          <video ref={videoRef} playsInline muted autoPlay style={{ filter: gradingFilter(settings) }} />
        </div>

        {settings.fx.grading && settings.faceFilter === "none" && (
          <div className="pointer-events-none absolute inset-0" style={{ background: "rgb(18,38,72)", mixBlendMode: "soft-light", opacity: 0.55 * intensity }} />
        )}

        <canvas ref={backRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <canvas ref={faceRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <canvas ref={frontRef} className="pointer-events-none absolute inset-0 h-full w-full" />

        <div ref={redRef} className="pointer-events-none absolute inset-0" style={{ background: "rgb(255,35,25)", mixBlendMode: "multiply", opacity: 0 }} />

        {settings.fx.vignette && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 75% 60% at 50% 48%, transparent 40%, rgba(2,4,10,${0.55 + 0.35 * intensity}) 100%), linear-gradient(to bottom, rgba(0,0,0,${0.5 * intensity}) 0%, transparent 14%, transparent 86%, rgba(0,0,0,${0.55 * intensity}) 100%)`,
            }}
          />
        )}
        {settings.fx.grading && <div className="grain pointer-events-none absolute inset-[-50%]" style={{ opacity: 0.07 + 0.06 * intensity }} />}

        {/* minimal public-facing status (only when something is wrong / loading) */}
        {camError && !panelOpen && (
          <div className="absolute inset-x-16 top-1/2 -translate-y-1/2 rounded-2xl border border-red-900/60 bg-black/80 p-10 text-center text-white">
            <div className="mb-4 text-6xl">🕯️</div>
            <p className="mb-6 text-3xl leading-snug text-red-200">{camError}</p>
            <div className="flex justify-center gap-4 text-2xl">
              <button className="rounded-lg bg-red-700 px-6 py-3" onClick={() => setCameraNonce((n) => n + 1)}>
                Retry
              </button>
              <button className="rounded-lg bg-white/15 px-6 py-3" onClick={() => setPanelOpen(true)}>
                Settings
              </button>
            </div>
          </div>
        )}
        {!camError && detStatus.state === "error" && !panelOpen && (
          <div className="absolute inset-x-16 top-1/2 -translate-y-1/2 rounded-2xl border border-red-900/60 bg-black/80 p-10 text-center text-white">
            <div className="mb-4 text-6xl">👻</div>
            <p className="mb-6 text-3xl leading-snug text-red-200">{detStatus.message}</p>
            <div className="flex justify-center gap-4 text-2xl">
              <button className="rounded-lg bg-red-700 px-6 py-3" onClick={() => engineRef.current?.reloadDetector()}>
                Retry
              </button>
              <button className="rounded-lg bg-white/15 px-6 py-3" onClick={() => setPanelOpen(true)}>
                Settings
              </button>
            </div>
          </div>
        )}
        {!camError && detStatus.state !== "error" && (!camLive || detStatus.state !== "ready") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-2xl tracking-[0.3em] text-white/50 animate-pulse">
            {!camLive ? "AWAKENING THE CAMERA…" : "SUMMONING SPIRITS…"}
          </div>
        )}

      </div>

      {/* invisible admin hotspot */}
      <div
        className="absolute right-0 top-0 z-40 h-32 w-32"
        onPointerDown={onHotspotDown}
        onPointerUp={onHotspotUp}
        onPointerLeave={onHotspotUp}
        onDoubleClick={() => setPanelOpen(true)}
      />

      {panelOpen && (
        <AdminPanel
          settings={settings}
          update={update}
          assets={assets}
          onUpload={onUpload}
          onDelete={onDelete}
          cameras={cameras}
          camError={camError}
          onRetryCamera={() => setCameraNonce((n) => n + 1)}
          detStatus={detStatus}
          stats={stats}
          audioUnlocked={audioUnlocked}
          onTestSound={() => {
            engineRef.current?.audio.unlock();
            setTimeout(() => {
              engineRef.current?.audio.stinger(1);
              engineRef.current?.audio.whoosh();
              setAudioUnlocked(!!engineRef.current?.audio.unlocked);
            }, 100);
          }}
          onFullscreen={toggleFullscreen}
          onReset={() => setSettings({ ...structuredClone(DEFAULT_SETTINGS), cameraId: settings.cameraId })}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
