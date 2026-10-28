export interface CameraDevice {
  deviceId: string;
  label: string;
}

const RES = {
  "480p": { width: 640, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;

export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function describeCameraError(err: unknown): string {
  const e = err as DOMException;
  switch (e?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access in the browser and press Retry.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No matching camera was found. Connect a camera or choose another one in settings.";
    case "NotReadableError":
      return "The camera is in use by another application or cannot be opened.";
    default:
      if (!window.isSecureContext) return "Camera access requires HTTPS or http://localhost.";
      if (!navigator.mediaDevices?.getUserMedia) return "This browser does not support camera access.";
      return `Camera error: ${e?.message ?? String(err)}`;
  }
}

export async function openCamera(
  deviceId: string | null,
  resolution: keyof typeof RES,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia not supported");
  const r = RES[resolution];
  const video: MediaTrackConstraints = {
    width: { ideal: r.width },
    height: { ideal: r.height },
    frameRate: { ideal: 30 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    // the saved camera may have been unplugged: fall back to any camera
    if (deviceId && (err as DOMException).name === "OverconstrainedError") {
      delete video.deviceId;
      return navigator.mediaDevices.getUserMedia({ video, audio: false });
    }
    throw err;
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
