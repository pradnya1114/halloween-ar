export type EntranceType = "rise" | "smoke" | "flyin" | "shoulder" | "teleport";
export type ExitType = "flyaway" | "dissolve" | "fade";
export type Rotation = 0 | 90 | 180 | 270;
export type FaceFilter = "none" | "random" | "skull" | "wraith" | "devil" | "vampire";
export type HalfFaceSide = "left" | "right";

export const FACE_FILTERS: { id: FaceFilter; label: string; emoji: string }[] = [
  { id: "none", label: "None", emoji: "📷" },
  { id: "random", label: "Random", emoji: "🎲" },
  { id: "skull", label: "Skull", emoji: "💀" },
  { id: "wraith", label: "Wraith", emoji: "👻" },
  { id: "devil", label: "Devil", emoji: "😈" },
  { id: "vampire", label: "Vampire", emoji: "🧛" },
];

export const ENTRANCES: { id: EntranceType; label: string }[] = [
  { id: "rise", label: "Rise from below" },
  { id: "smoke", label: "Materialize in smoke" },
  { id: "flyin", label: "Fly in from edge" },
  { id: "shoulder", label: "Behind the shoulder" },
  { id: "teleport", label: "Teleport flash" },
];

export const EXITS: { id: ExitType; label: string }[] = [
  { id: "flyaway", label: "Fly away" },
  { id: "dissolve", label: "Dissolve to smoke" },
  { id: "fade", label: "Flicker fade" },
];

export interface FxSettings {
  grading: boolean;
  fog: boolean;
  vignette: boolean;
  flicker: boolean;
  redFlashes: boolean;
  bats: boolean;
  crows: boolean;
  silhouettes: boolean;
  glitch: boolean;
}

export interface Settings {
  // camera
  cameraId: string | null;
  mirror: boolean;
  rotation: Rotation;
  resolution: "480p" | "720p" | "1080p";
  // detection
  model: "lite" | "full";
  maxPeople: number;
  detectionConfidence: number;
  detectFps: number;
  occlusion: boolean;
  /** Face-only is the default. Turn on to also run the body (pose) model. */
  bodyTracking: boolean;
  // facial expression effects
  exprBlink: boolean;
  exprMouth: boolean;
  exprHead: boolean;
  showFaceDebug: boolean;
  confirmFrames: number;
  lostTimeoutMs: number;
  // face
  faceFilter: FaceFilter;
  faceMaskStrength: number;
  maskDelaySec: number;
  halfFace: boolean;
  halfFaceSide: HalfFaceSide;
  hornSize: number;
  hornHeight: number;
  hornSpread: number;
  hornFire: boolean;
  // ghosts
  ghostsPerPerson: number;
  ghostSize: number;
  ghostOpacity: number;
  animSpeed: number;
  spawnDelay: number;
  spawnInterval: number;
  cycleGhosts: boolean;
  cycleSeconds: number;
  entrances: Record<EntranceType, boolean>;
  exits: Record<ExitType, boolean>;
  // assets
  activeCollection: string; // "all" or collection name
  assetEnabled: Record<string, boolean>;
  assetScale: Record<string, number>;
  // effects
  fx: FxSettings;
  fogDensity: number;
  effectIntensity: number;
  // sound
  sound: boolean;
  muted: boolean;
  volume: number;
  // debug
  showDebug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  cameraId: null,
  mirror: true,
  rotation: 0,
  resolution: "720p",
  model: "lite",
  maxPeople: 4,
  detectionConfidence: 0.5,
  detectFps: 24,
  occlusion: true,
  bodyTracking: false,
  exprBlink: true,
  exprMouth: true,
  exprHead: true,
  showFaceDebug: false,
  confirmFrames: 4,
  lostTimeoutMs: 900,
  faceFilter: "skull",
  faceMaskStrength: 1,
  maskDelaySec: 3,
  halfFace: false,
  halfFaceSide: "left",
  hornSize: 1,
  hornHeight: -0.04,
  hornSpread: 1,
  hornFire: true,
  ghostsPerPerson: 3,
  ghostSize: 0.5,
  ghostOpacity: 0.78,
  animSpeed: 1,
  spawnDelay: 0.9,
  spawnInterval: 0.9,
  cycleGhosts: true,
  cycleSeconds: 14,
  entrances: { rise: true, smoke: true, flyin: true, shoulder: true, teleport: true },
  exits: { flyaway: true, dissolve: true, fade: true },
  activeCollection: "all",
  assetEnabled: {},
  assetScale: {},
  fx: {
    grading: true,
    fog: true,
    vignette: true,
    flicker: true,
    redFlashes: true,
    bats: true,
    crows: true,
    silhouettes: true,
    glitch: true,
  },
  fogDensity: 0.6,
  effectIntensity: 0.7,
  sound: true,
  muted: false,
  volume: 0.6,
  showDebug: false,
};

const KEY = "halloween-ar-settings-v5";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      entrances: { ...DEFAULT_SETTINGS.entrances, ...(parsed.entrances ?? {}) },
      exits: { ...DEFAULT_SETTINGS.exits, ...(parsed.exits ?? {}) },
      fx: { ...DEFAULT_SETTINGS.fx, ...(parsed.fx ?? {}) },
      assetEnabled: { ...(parsed.assetEnabled ?? {}) },
      assetScale: { ...(parsed.assetScale ?? {}) },
    };
    if (!FACE_FILTERS.some((f) => f.id === merged.faceFilter)) merged.faceFilter = "skull";
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / private mode */
  }
}
