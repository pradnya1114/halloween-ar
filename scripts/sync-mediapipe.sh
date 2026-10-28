#!/usr/bin/env bash
# Copy MediaPipe WASM from node_modules into public/ so Vite serves real .wasm
# files (not the SPA index.html fallback).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/@mediapipe/tasks-vision/wasm"
DST="$ROOT/public/mediapipe/wasm"
mkdir -p "$DST" "$ROOT/public/models"
cp -f "$SRC/vision_wasm_internal.js" "$SRC/vision_wasm_internal.wasm" \
      "$SRC/vision_wasm_nosimd_internal.js" "$SRC/vision_wasm_nosimd_internal.wasm" \
      "$DST/"
echo "Copied WASM to $DST"
if [ ! -f "$ROOT/public/models/pose_landmarker_lite.task" ]; then
  curl -fsL -o "$ROOT/public/models/pose_landmarker_lite.task" \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task
fi
if [ ! -f "$ROOT/public/models/pose_landmarker_full.task" ]; then
  curl -fsL -o "$ROOT/public/models/pose_landmarker_full.task" \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
fi
echo "OK"
