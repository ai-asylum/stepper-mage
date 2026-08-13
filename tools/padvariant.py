#!/usr/bin/env python3
"""
Pad a variant sprite's canvas up to its base sprite's, bottom-aligned.

    tools/padvariant.py altar altar_empty

World size is `pixels / spritePpu` (src/dungeon/sprites.ts), so two sprites of
the same subject must share a canvas or the renderer will draw them at different
sizes. The trap is the OPPOSITE of the obvious one: giving both the same height
is what breaks it. `genart.py` crops each generation to its content and scales
that to the manifest height, and the active altar spends most of its height on a
book floating above the pedestal while the spent one is pedestal to the top —
same 150px canvas, pedestal four times the size.

So the variant is GENERATED shorter (its own manifest height, chosen so the two
pedestals measure the same) and then padded back here. Padding is lossless;
rescaling to fit would resample the art off its own pixel grid, which is the one
thing the whole pipeline exists to avoid.

Bottom-aligned because props stand on the floor — the empty rows belong above,
where the book used to be.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def foot(im: Image.Image, frac: float = 0.45) -> int:
    """Width of the widest opaque row in the bottom `frac` of the sprite."""
    a = im.split()[-1]
    w, h = im.size
    px = a.load()
    best = 0
    for y in range(int(h * (1 - frac)), h):
        xs = [x for x in range(w) if px[x, y] > 8]
        if xs:
            best = max(best, xs[-1] - xs[0] + 1)
    return best


def pad(base_id: str, variant_id: str, subdir: str = "") -> None:
    d = ROOT / "public" / "art" / subdir
    base_p, var_p = d / f"{base_id}.png", d / f"{variant_id}.png"
    if not (base_p.exists() and var_p.exists()):
        print(f"  [skip] {subdir or '144'}: missing one of the pair")
        return
    base, var = Image.open(base_p).convert("RGBA"), Image.open(var_p).convert("RGBA")
    if var.size == base.size:
        print(f"  [have] {subdir or '144'}/{variant_id} already {base.size}")
        return
    if var.width > base.width or var.height > base.height:
        print(f"  [WARN] {subdir or '144'}/{variant_id} {var.size} exceeds base {base.size} — "
              "lower its manifest height instead of padding")
        return
    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    out.paste(var, ((base.width - var.width) // 2, base.height - var.height))
    out.save(var_p)
    print(f"  [pad ] {subdir or '144'}/{variant_id} {var.size} -> {base.size}  "
          f"(footprint {foot(var)} vs base {foot(base)})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: padvariant.py <base-id> <variant-id>")
    b, v = sys.argv[1], sys.argv[2]
    for sub in ("", "s72", "s36"):
        pad(b, v, sub)
