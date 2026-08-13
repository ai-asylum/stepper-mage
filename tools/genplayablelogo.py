#!/usr/bin/env python3
"""
Shrink the generated logo down to something a playable ad can afford.

    tools/genplayablelogo.py

`store/logo.png` is ~1.2 MB at 1024². The creative has a hard 5 MB budget and
inlines every asset as a data URI, so shipping the full logo would eat most of
the remaining headroom for a mark that is never drawn larger than ~460 CSS px.

Palette-quantised rather than merely resized: the source is pixel art with a
small number of distinct colours, so an adaptive palette costs nothing visible
and roughly halves the file again. No dither, for the same reason — dithering
invents colours the art does not have and defeats the palette.
"""
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "store" / "logo.png"
OUT = ROOT / "src" / "playable" / "logo.png"
SIZE = 512
COLORS = 96

if not SRC.exists():
    raise SystemExit(f"missing {SRC} — generate it first (tools/genlogoart.mjs)")

im = Image.open(SRC).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
q = im.quantize(colors=COLORS, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGBA")

# Key the background OUT.
#
# The ad draws this over its own scrim, and the logo carries the generation's
# deep violet-black plate — near-black on near-black still reads as a hard
# rectangle around the mark. Keyed by luminance rather than exact match,
# because the plate is a spread of very dark values and an equality test
# leaves a confetti halo.
px = q.load()
for y in range(SIZE):
    for x in range(SIZE):
        r, g, b, _ = px[x, y]
        if r * 0.299 + g * 0.587 + b * 0.114 < 26:
            px[x, y] = (r, g, b, 0)
q.save(OUT, optimize=True)
print(f"  {OUT.relative_to(ROOT)}  {SIZE}×{SIZE}  {COLORS} colours  {os.path.getsize(OUT) // 1024} KB")
