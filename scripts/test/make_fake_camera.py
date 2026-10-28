#!/usr/bin/env python3
"""
Builds an MJPEG clip used as a *fake webcam* for automated end-to-end testing
(Chrome flag --use-file-for-fake-video-capture=clip.mjpeg).

Timeline (30 fps, loops): 0-3s empty hallway, 3-23s two people moving, 23-30s empty.
"""
import io
import math
import sys
from PIL import Image, ImageFilter

src = Image.open(sys.argv[1] if len(sys.argv) > 1 else "scripts/test/people.jpg").convert("RGB")
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fake_camera.mjpeg"
W, H = 720, 1280
base = src.resize((int(src.width * H / src.height), H))
empty = base.filter(ImageFilter.GaussianBlur(60))  # no recognisable people

with open(out, "wb") as f:
    for i in range(900):
        frame = Image.new("RGB", (W, H))
        if 90 <= i < 690:
            dx = int(math.sin((i - 90) / 60) * 60)
            frame.paste(base, ((W - base.width) // 2 + dx, 0))
        else:
            frame.paste(empty, ((W - empty.width) // 2, 0))
        buf = io.BytesIO()
        frame.save(buf, "JPEG", quality=70)
        f.write(buf.getvalue())
print("wrote", out)
