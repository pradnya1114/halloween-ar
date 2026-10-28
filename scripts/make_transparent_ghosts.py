#!/usr/bin/env python3
"""
Converts ghost artwork rendered on a pure black background into transparent PNGs.

Alpha is derived from luminance (ethereal "screen-like" keying) and the colour is
un-premultiplied so the ghost looks identical when composited over any background.

Usage:
    python3 scripts/make_transparent_ghosts.py scripts/raw src/assets/ghosts
Requires: pip install pillow numpy
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAX_SIZE = 640  # keeps the single-file build small; ghosts are drawn <= ~700px


def key_black(src: Path, dst: Path) -> None:
    im = Image.open(src).convert("RGB")
    im.thumbnail((MAX_SIZE, MAX_SIZE), Image.LANCZOS)
    rgb = np.asarray(im).astype(np.float32) / 255.0
    mx = rgb.max(axis=2)
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    v = np.maximum(mx, lum)
    # remove near-black noise, then gently boost body opacity
    a = np.clip((v - 0.045) / 0.6, 0.0, 1.0)
    a = a ** 0.8
    # feather edges of the canvas so no hard borders remain
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]).astype(np.float32)
    a *= np.clip(edge / 12.0, 0.0, 1.0)
    safe = np.maximum(a, 1e-4)[..., None]
    col = np.clip(rgb / safe, 0.0, 1.0)
    col = np.where(a[..., None] > 1e-3, col, 0.0)
    out = np.dstack([col, a])
    Image.fromarray((out * 255).astype(np.uint8), "RGBA").save(dst, optimize=True)
    print(f"{src.name} -> {dst} ({dst.stat().st_size // 1024} KB)")


def main() -> None:
    src_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "scripts/raw")
    dst_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "src/assets/ghosts")
    dst_dir.mkdir(parents=True, exist_ok=True)
    for f in sorted(src_dir.iterdir()):
        if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            key_black(f, dst_dir / (f.stem + ".png"))


if __name__ == "__main__":
    main()
