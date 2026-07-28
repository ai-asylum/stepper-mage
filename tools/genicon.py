#!/usr/bin/env python3
"""
Build the add-to-home-screen icon set from art/_work/raw/appicon.png.

Different from the sprite pipeline in two ways that matter:
  - the background is KEPT. An app icon is a full-bleed square; iOS composites
    transparency onto white and the book would end up floating on a white card.
  - a MASKABLE variant is produced with the art inset ~11%, because Android
    crops maskable icons to a circle/squircle and an edge-to-edge design loses
    its corners.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "_work" / "raw" / "appicon.png"
OUT = ROOT / "public" / "icons"
BG = (10, 7, 16, 255)          # matches the manifest's background_color


def square(img: Image.Image) -> Image.Image:
    """Centre-crop to a square so no axis gets squashed."""
    w, h = img.size
    s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def pixelate(img: Image.Image, size: int, grid: int, colors: int) -> Image.Image:
    """
    Resample onto a coarse pixel grid, quantise, then blow back up with NEAREST.
    The icon has to read as the same pixel art as the game, and a plain smooth
    downscale of a 1024px image just looks like a blurry photo of a book.
    """
    small = img.resize((grid, grid), Image.BOX)
    small = small.convert("RGB").quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    return small.convert("RGB").resize((size, size), Image.NEAREST)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC} — generate it first")
    OUT.mkdir(parents=True, exist_ok=True)

    base = square(Image.open(SRC).convert("RGB"))

    # Full-bleed icons. The pixel grid stays coarse on purpose so the art style
    # survives at 48px on a home screen.
    for size, grid in ((512, 64), (192, 48), (180, 45)):
        icon = pixelate(base, size, grid, 48)
        name = "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
        icon.save(OUT / name, optimize=True)
        print(f"  {name}  ({grid}px grid)")

    # Maskable: inset so Android's circular crop cannot eat the gold corners.
    for size, grid in ((512, 64), (192, 48)):
        pad = round(size * 0.11)
        inner = pixelate(base, size - pad * 2, grid, 48)
        canvas = Image.new("RGB", (size, size), BG[:3])
        canvas.paste(inner, (pad, pad))
        canvas.save(OUT / f"icon-maskable-{size}.png", optimize=True)
        print(f"  icon-maskable-{size}.png")

    # A favicon for the browser tab.
    pixelate(base, 32, 32, 32).save(OUT / "favicon.png", optimize=True)
    print("  favicon.png")


if __name__ == "__main__":
    main()
