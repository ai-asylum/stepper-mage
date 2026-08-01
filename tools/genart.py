#!/usr/bin/env python3
"""
Stepper Mage art pipeline.

Reads art/manifest.json, generates any missing sprite through the Scenario
asset-creator CLI, then post-processes it into a REAL pixel-art sprite:

    1024px "fake" pixel art  ->  crop to content  ->  area-resample onto the
    true pixel grid  ->  adaptive palette quantise  ->  hard alpha  ->  keyline

The last steps matter. The model returns 1024x1024 images whose "pixels" are
~8px blocks; blitting that into the game next to a 240px-wide render would show
two different pixel sizes at once and instantly read as fake. Resampling onto a
~96-128px grid makes every pixel a real pixel.

Backgrounds are knocked out locally (flood fill from the border) rather than via
the API's --remove-bg, which costs another round trip per asset for a job the
white background makes trivial.

Usage:
    tools/genart.py            # generate everything missing
    tools/genart.py --only id1,id2
    tools/genart.py --force    # regenerate even if the output exists
    tools/genart.py --post     # re-run post-processing from cached raws only
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "art" / "manifest.json"
RAW_DIR = ROOT / "art" / "_work" / "raw"          # git-ignored cache of 1K gens
OUT_DIR = ROOT / "public" / "art"                 # committed, game-ready
ASSET_CREATOR = Path.home() / "dev" / "loadout-library" / "skills" / "asset-creator" / "scripts"

# Shared style contract. Every sprite in the game goes through this so the whole
# roster reads as one artist's hand.
STYLE = (
    "16-bit SNES-era pixel art, clean solid dark keyline outline around the whole "
    "subject, limited palette, dithered shading, strong readable silhouette, "
    "high contrast, no anti-aliasing, no background gradient"
)

FRAMING = {
    # First-person dungeon: everything is a billboard seen straight on.
    "creature": (
        "IMPORTANT: front-facing camera, straight-on at eye level, the subject faces "
        "the viewer directly, symmetrical stance. FULL BODY from head to feet, "
        "centered, with a small margin of empty space at every edge."
    ),
    "prop": (
        "IMPORTANT: front-facing camera, straight-on at eye level, viewed directly "
        "from the front. The WHOLE object is visible, centered, resting on the ground, "
        "with a small margin of empty space at every edge."
    ),
    "boss": (
        "IMPORTANT: front-facing camera, straight-on at eye level, the subject faces "
        "the viewer directly, imposing symmetrical stance. FULL BODY from head to feet, "
        "centered, with a small margin of empty space at every edge."
    ),
    "icon": (
        "IMPORTANT: a single centered emblem on a plain white background, flat "
        "front-on view, no perspective, no scene, no background elements."
    ),
}


def load_keys() -> dict[str, str]:
    """Pull Scenario credentials from 1Password unless already in the env."""
    env = os.environ.copy()
    if env.get("SCENARIO_API_KEY") and env.get("SCENARIO_API_SECRET"):
        return env
    for var, ref in (
        ("SCENARIO_API_KEY", "op://Secrets/Scenario/SCENARIO_API_KEY"),
        ("SCENARIO_API_SECRET", "op://Secrets/Scenario/SCENARIO_API_SECRET"),
    ):
        out = subprocess.run(["op", "read", ref], capture_output=True, text=True)
        if out.returncode != 0:
            sys.exit(f"could not read {ref} from 1Password: {out.stderr.strip()}")
        env[var] = out.stdout.strip()
    return env


def build_prompt(asset: dict) -> str:
    kind = asset.get("kind", "creature")
    parts = [
        "A single subject centered in frame on a plain solid white background.",
        asset["prompt"].strip(),
        STYLE + ".",
        FRAMING.get(kind, FRAMING["creature"]),
    ]
    if extra := asset.get("extra"):
        parts.append(extra.strip())
    return " ".join(parts)


def generate(asset: dict, env: dict[str, str], force: bool) -> Path | None:
    """Generate the 1K raw for one asset (cached in art/_work/raw)."""
    raw = RAW_DIR / f"{asset['id']}.png"
    if raw.exists() and not force:
        return raw
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "uvx", "--from", str(ASSET_CREATOR), "asset-creator",
        "--prompt", build_prompt(asset),
        "--aspect", asset.get("aspect", "1:1"),
        "--resolution", "1K",
        "--seed", str(asset.get("seed", 1234)),
        "--output", str(raw),
    ]
    print(f"  [gen] {asset['id']}", flush=True)
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if res.returncode != 0 or not raw.exists():
        print(f"  [FAIL] {asset['id']}: {res.stderr.strip()[:300]}", flush=True)
        return None
    print(f"  [ok ] {asset['id']}", flush=True)
    return raw


# ----------------------------------------------------------------- post-process

def knock_out_background(img: Image.Image, tol: int = 26) -> Image.Image:
    """
    Flood fill transparency inward from the border over near-white pixels.

    A flood fill (rather than a global "white -> alpha" pass) preserves white
    *inside* the sprite — book pages, bone, skull teeth, star glints — which a
    global threshold would punch holes through.
    """
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    def is_bg(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        if a == 0:
            return True
        return r >= 255 - tol and g >= 255 - tol and b >= 255 - tol

    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(x, y):
                q.append((x, y)); seen[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(x, y) and not seen[y * w + x]:
                q.append((x, y)); seen[y * w + x] = 1

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_bg(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return img


def crop_to_content(img: Image.Image, pad: int = 2) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    w, h = img.size
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(w, x1 + pad); y1 = min(h, y1 + pad)
    return img.crop((x0, y0, x1, y1))


def to_pixel_grid(
    img: Image.Image, target_h: int, colors: int, target_w: int | None = None
) -> Image.Image:
    """Area-resample onto the true pixel grid, then quantise the palette.

    `target_w` overrides the aspect-derived width. Only the stepped rosters pass
    it, and they pass it for one reason: a width rounded independently at each
    density drifts by up to a texel, which at 18 is four percent of a creature.
    The lower steps take their exact dimensions from the 144 art instead.
    """
    w, h = img.size
    scale = target_h / h
    tw = max(1, target_w if target_w is not None else round(w * scale))
    small = img.resize((tw, target_h), Image.BOX)

    # Hard alpha: pixel art has no partial coverage. Do this BEFORE quantising so
    # semi-transparent halo pixels don't get folded into the palette as mud.
    a = small.getchannel("A").point(lambda v: 255 if v >= 110 else 0)
    small.putalpha(a)

    # Quantise only the visible pixels. Compositing onto magenta then quantising
    # would drag the key colour into the palette, so quantise RGB separately and
    # re-apply the hard alpha afterwards.
    rgb = small.convert("RGB").quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    out = rgb.convert("RGBA")

    # Re-inject hot highlights. Median-cut allocates palette entries by pixel
    # COUNT, so a creature's few white-hot eye pixels get folded into the nearest
    # bulk colour and the glow dies — which is the one detail that sells these
    # designs. Copy the brightest pre-quantise pixels back verbatim.
    src = small.load()
    dst = out.load()
    for y in range(target_h):
        for x in range(tw):
            r, g, b, sa = src[x, y]
            if sa == 0:
                continue
            # luminance, plus a saturated-and-bright test so coloured glows
            # (violet eyes, orange lava, green spores) survive too
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            mx, mn = max(r, g, b), min(r, g, b)
            if lum > 208 or (mx > 190 and mx - mn > 70):
                dst[x, y] = (r, g, b, 255)

    out.putalpha(a)
    return out


def add_keyline(img: Image.Image, rgb=(14, 9, 18)) -> Image.Image:
    """
    One-pixel dark keyline around the silhouette. The model usually draws one,
    but downscaling thins it unevenly; re-asserting it is what makes a sprite
    hold together against a torch-lit wall.
    """
    w, h = img.size
    out = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(img, (1, 1))
    px = out.load()
    ow, oh = out.size
    solid = [[px[x, y][3] > 0 for y in range(oh)] for x in range(ow)]
    edges = []
    for x in range(ow):
        for y in range(oh):
            if solid[x][y]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < ow and 0 <= ny < oh and solid[nx][ny]:
                    edges.append((x, y))
                    break
    for x, y in edges:
        px[x, y] = (*rgb, 255)
    return out


def post(asset: dict, raw: Path) -> None:
    img = Image.open(raw)
    img = knock_out_background(img)
    img = crop_to_content(img)
    img = to_pixel_grid(img, asset.get("height", 112), asset.get("colors", 32))
    if asset.get("keyline", True):
        img = add_keyline(img)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / f"{asset['id']}.png"
    img.save(dest, optimize=True)
    print(f"  [pix] {asset['id']} -> {img.size[0]}x{img.size[1]}", flush=True)


# ------------------------------------------------------------------- pixel steps

# How each texel density is resampled. Three knobs, and they do not move
# together — which is the whole reason this is a table and not a scale factor.
#
#   colors   A coarse grid is not a fine grid with fewer pixels, it is fewer
#            FEATURES, and a palette is a feature. Thirty-two entries across an
#            18-step creature's ~300 pixels is one per nine, which spends the
#            palette on noise the eye reads as dirt.
#
#   blur     Kills detail finer than a resample cell BEFORE the box filter can
#            beat against it. Needed most in the middle: at 72 the cell is close
#            enough to the raw's own ~8px block that they alias badly, while at
#            18 a cell is so large that the box average has already destroyed
#            everything below it and the blur only costs structure. Blurring 18
#            as hard as 72 is what turned the bookshelf into a brown rectangle.
#
#   contrast Averaging pulls every tone toward the local mean, so the fewer
#            pixels a shape gets the flatter it comes out. The coarser the grid,
#            the harder the survivors have to work — this is what puts the
#            shelves back in the bookshelf and the teeth back on the gears.
STEP_TUNE = {
    144: {"colors": 32, "blur": 0.00, "contrast": 1.00},
    72: {"colors": 24, "blur": 0.30, "contrast": 1.05},
    36: {"colors": 16, "blur": 0.24, "contrast": 1.12},
    18: {"colors": 16, "blur": 0.16, "contrast": 1.22},
}


def presoften(img: Image.Image, radius: float) -> Image.Image:
    """
    Blur the raw's sub-cell detail away before it can alias.

    The raws are 1024px images of "pixel art" whose pixels are ~8px blocks, plus
    real fine detail — the radiating lines on the boss's page, the spines on a
    bookshelf. At 144 a resample cell is ~5px and that detail lands roughly one
    feature per cell. At 36 a cell is ~20px and at 18 it is ~40, and a box filter
    over detail finer than its own cell does not average it away cleanly: it
    beats against it. The 36 boss came out as violet salt-and-pepper where a page
    should be, which is the same failure as an ordered dither over a flat tone —
    high-frequency noise standing in for a tone.

    Only RGB is softened. Alpha is left exactly as it was, so the silhouette and
    its coverage are decided by the full-resolution edge and a blur cannot eat
    into it. That needs the premultiply/unpremultiply dance, because blurring
    straight RGB drags the transparent border's black in around the outline.
    """
    if radius <= 0.5:
        return img
    import numpy as np

    blur = ImageFilter.GaussianBlur(radius)
    arr = np.asarray(img.convert("RGBA"), dtype=np.float32)
    a = arr[..., 3:4] / 255.0

    # Premultiplied blur, then divide the coverage back out. Blurring straight
    # RGB would drag the knocked-out background (still white under alpha 0) in
    # around the whole outline as a halo; weighting by coverage means a pixel
    # just inside the silhouette averages only over the pixels that are actually
    # part of the sprite.
    pm = Image.fromarray((arr[..., :3] * a).astype("uint8"), "RGB").filter(blur)
    cov = Image.fromarray(arr[..., 3].astype("uint8"), "L").filter(blur)
    num = np.asarray(pm, dtype=np.float32)
    den = np.asarray(cov, dtype=np.float32)[..., None] / 255.0
    rgb = np.where(den > 1e-3, num / np.maximum(den, 1e-3), arr[..., :3])

    out = arr.copy()
    out[..., :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(out.astype("uint8"), "RGBA")


def punch(img: Image.Image, amount: float) -> Image.Image:
    """Raise contrast on the colour only, leaving the silhouette alone."""
    if amount == 1.0:
        return img
    r, g, b, a = img.split()
    rgb = ImageEnhance.Contrast(Image.merge("RGB", (r, g, b))).enhance(amount)
    return Image.merge("RGBA", (*rgb.split(), a))


def step_dir(step: int) -> Path:
    """Where a step's roster lives. 144 is the committed default and stays put."""
    return OUT_DIR if step == 144 else OUT_DIR / f"s{step}"


def post_step(asset: dict, raw: Path, step: int) -> tuple[int, int] | None:
    """
    Re-derive one sprite at a coarser density, FROM THE RAW.

    Not a downsample of the shipped 144 PNG: that is already quantised to 32
    colours and keylined, and squeezing it again would carry both of those
    decisions down to a grid that wanted different ones. This goes back to the
    1024px raw and repeats the whole pipeline against the smaller grid.

    The 144 art still decides the SIZE. Final dimensions are exactly `step/144`
    of what ships today, so `pixels / spritePpu` is identical at every step and
    the quad does not move — which is the one thing this must not get wrong.
    """
    ref = OUT_DIR / f"{asset['id']}.png"
    if not ref.exists():
        print(f"  [skip] {asset['id']} (no 144 art to size against)")
        return None
    with Image.open(ref) as r:
        w144, h144 = r.size

    k = step / 144
    fw, fh = max(3, round(w144 * k)), max(3, round(h144 * k))
    keyline = asset.get("keyline", True)
    # The keyline is one texel at every density, and it is drawn OUTSIDE the
    # silhouette — so the grid the creature itself is resampled onto is two
    # texels smaller in each axis than the file that ships.
    pad = 2 if keyline else 0

    tune = STEP_TUNE[step]
    img = Image.open(raw)
    img = knock_out_background(img)
    img = crop_to_content(img)
    cell = img.height / max(1, fh - pad)
    img = presoften(img, cell * tune["blur"])
    img = punch(img, tune["contrast"])
    img = to_pixel_grid(img, fh - pad, tune["colors"], target_w=fw - pad)
    if keyline:
        img = add_keyline(img)

    out = step_dir(step)
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / f"{asset['id']}.png", optimize=True)
    return img.size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated asset ids")
    ap.add_argument("--force", action="store_true", help="regenerate existing raws")
    ap.add_argument("--post", action="store_true", help="post-process cached raws only")
    ap.add_argument("--steps", help="comma-separated texel densities to re-derive, e.g. 72,36,18")
    ap.add_argument("--jobs", type=int, default=4, help="parallel generations")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    # The manifest carries `$floor` / `$comment` section markers for readability;
    # only rows with an `id` are real assets.
    assets = [a for a in manifest["assets"] if "id" in a]
    if args.only:
        want = {s.strip() for s in args.only.split(",")}
        assets = [a for a in assets if a["id"] in want]
    if not assets:
        sys.exit("no assets selected")

    if args.steps:
        steps = [int(s) for s in args.steps.split(",")]
        for step in steps:
            print(f"step {step} -> {step_dir(step).relative_to(ROOT)}")
            for a in assets:
                raw = RAW_DIR / f"{a['id']}.png"
                if not raw.exists():
                    print(f"  [skip] {a['id']} (no raw)")
                    continue
                size = post_step(a, raw, step)
                if size:
                    print(f"  [pix] {a['id']} -> {size[0]}x{size[1]}", flush=True)
        return

    if args.post:
        for a in assets:
            raw = RAW_DIR / f"{a['id']}.png"
            if raw.exists():
                post(a, raw)
            else:
                print(f"  [skip] {a['id']} (no raw)")
        return

    env = load_keys()
    todo = [a for a in assets if args.force or not (RAW_DIR / f"{a['id']}.png").exists()]
    print(f"{len(assets)} selected, {len(todo)} to generate, {args.jobs} at a time")

    if todo:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            list(pool.map(lambda a: generate(a, env, args.force), todo))

    for a in assets:
        raw = RAW_DIR / f"{a['id']}.png"
        if raw.exists():
            post(a, raw)


if __name__ == "__main__":
    main()
