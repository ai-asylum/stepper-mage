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

Backgrounds come from the API's background remover, cached in raw/nobg/ by
tools/rembg.sh. A local flood fill from the border was tried first and is still
the fallback, but it can only reach background that touches the border — see
`matted()` for what that left inside the silhouettes.

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


# Style contract for a COARSE raw, replacing STYLE when generating for a low
# density. The model cannot output a 24px image — it returns 1024px whatever you
# ask — so the density has to be spent on the SUBJECT rather than the file: fewer,
# larger shapes, no fine ornament, no dithering, and contrast strong enough that a
# feature survives being averaged into two or three texels. What comes back is
# still resampled; the point is that it was composed to be.
#
# TRIED AND NOT ADOPTED. Six assets were generated this way and compared against
# the resampled roster at both 18 and 36. The raws did come back simpler and
# bolder, and it still did not make 18 viable — a bookshelf is a brown rectangle
# and the floor-1 boss has no eye either way, because the limit is nineteen texels
# and not the source art. At 36 it was a wash, and worse on the hulk and the gears.
#
# The cost that settles it: changing the prompt changes what the model returns, so
# every regenerated asset comes back as a DIFFERENT DESIGN — the floor-1 boss went
# from an open book with a violet eye to a winged figure. Regenerating part of the
# roster makes it inconsistent, and regenerating all of it is a redesign of the
# game's art, which is not what a graphics setting should cost.
#
# Kept so the finding is re-testable, not because anything ships from it.
COARSE_STYLE = (
    "EXTREMELY LOW RESOLUTION pixel art, like a {n}x{n} pixel sprite blown up huge. "
    "Enormous chunky square pixels, each visible block the size of a fingertip. "
    "Only {c} flat colours, no gradients, NO dithering, no texture, no fine detail, "
    "no small ornaments. Bold simple silhouette readable at a glance, one or two "
    "large defining features only, heavy dark outline, very high contrast"
)


def build_prompt(asset: dict, coarse: int = 0) -> str:
    kind = asset.get("kind", "creature")
    if coarse:
        style = COARSE_STYLE.format(n=coarse, c=STEP_TUNE.get(coarse, {}).get("colors", 16))
    else:
        style = STYLE
    parts = [
        "A single subject centered in frame on a plain solid white background.",
        asset["prompt"].strip(),
        style + ".",
        FRAMING.get(kind, FRAMING["creature"]),
    ]
    if extra := asset.get("extra"):
        parts.append(extra.strip())
    return " ".join(parts)


def raw_path(asset_id: str, coarse: int = 0) -> Path:
    """Raws are cached per density. The 144 raws are never overwritten."""
    return (RAW_DIR / f"c{coarse}" / f"{asset_id}.png") if coarse else RAW_DIR / f"{asset_id}.png"


def matted(raw: Path) -> Path | None:
    """
    The properly matted version of a raw, if one has been fetched.

    `knock_out_background` floods in from the border, so it can only reach
    background that TOUCHES the border. Everything the subject encloses survives:
    the gap inside a telescope's tripod, the arch under the lectern, the space
    between a hound's legs and through its ribcage, the whole interior of the
    meat rack's frame. Those shipped as opaque white rectangles inside the
    silhouette.

    It cannot simply be made more aggressive, either. The reason it is a flood
    fill and not a "white -> alpha" threshold is that white INSIDE a sprite is
    real art — bone, teeth, page, starlight — and a threshold punches holes
    through all of it. Telling those two whites apart is a matting problem, so it
    is handed to a matting model: `tools/rembg.sh` runs the generator's own
    background remover over the cached raws and drops the result in `raw/nobg/`.

    Run against the EXISTING raws, so no art changes — same seed, same image, just
    an alpha channel that understands what the subject is.
    """
    m = raw.parent / "nobg" / raw.name
    return m if m.exists() else None


def generate(asset: dict, env: dict[str, str], force: bool, coarse: int = 0) -> Path | None:
    """Generate the 1K raw for one asset (cached in art/_work/raw)."""
    raw = raw_path(asset["id"], coarse)
    if raw.exists() and not force:
        return raw
    raw.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "uvx", "--from", str(ASSET_CREATOR), "asset-creator",
        "--prompt", build_prompt(asset, coarse),
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
    img: Image.Image, target_h: int, colors: int, target_w: int | None = None,
    median: bool = False, sharpen: float = 0.0,
) -> Image.Image:
    """Resample onto the true pixel grid, then quantise the palette.

    `target_w` overrides the aspect-derived width. Only the stepped rosters pass
    it, and they pass it for one reason: a width rounded independently at each
    density drifts by up to a texel, which at 18 is four percent of a creature.
    The lower steps take their exact dimensions from the 144 art instead.

    `median` picks the REPRESENTATIVE colour of each cell instead of the average.
    Three ways to answer "what colour is this texel" were compared at 36:

      mean (BOX)   soft and muddy. A cell twenty source pixels across contains a
                   book spine, its shadow and the shelf behind it, and averaging
                   returns brown. The bookshelf lost its shelves this way.
      point        crisp and noisy. Sampling ONE pixel out of that cell keeps the
                   edges but catches whatever outlier it lands on, so the boss
                   arrived under a confetti of stray white and gold texels.
      median       both. Downscale to three times the target so a cell becomes a
                   3x3 neighbourhood, take the median of it, then point-sample.
                   An outlier cannot be a median, and unlike a mean a median does
                   not invent a colour that is not there — which for art made of
                   flat blocks is exactly the right question to ask.

    It replaced a Gaussian pre-blur that existed to stop sub-cell detail aliasing.
    The median does that job better and without the cost, because it is an
    edge-preserving filter and a blur is not.
    """
    w, h = img.size
    scale = target_h / h
    tw = max(1, target_w if target_w is not None else round(w * scale))
    if median:
        mid = img.resize((tw * 3, target_h * 3), Image.BOX)
        small = mid.filter(ImageFilter.MedianFilter(3)).resize((tw, target_h), Image.NEAREST)
        small = small.convert("RGBA")
        if sharpen > 0:
            # Pull the median back toward a true point sample.
            #
            # The median itself does not flatten anything — a median is always a
            # value that was actually there. What flattens is the 3x BOX step in
            # front of it, which is a mean over a third of a cell, so the darkest
            # and the brightest thirds are gone before the median ever votes. The
            # result is stable and slightly washed.
            #
            # Blending toward the raw point sample puts that range back without
            # putting the noise back, because the median stays the anchor and this
            # only moves it partway. At 1.0 it IS the point sample, confetti and
            # all; the useful band is well under half.
            pt = img.resize((tw, target_h), Image.NEAREST)
            m, p = small.load(), pt.convert("RGBA").load()
            for y in range(target_h):
                for x in range(tw):
                    mr, mg, mb, ma = m[x, y]
                    pr, pg, pb, _ = p[x, y]
                    m[x, y] = (
                        max(0, min(255, round(mr + sharpen * (pr - mr)))),
                        max(0, min(255, round(mg + sharpen * (pg - mg)))),
                        max(0, min(255, round(mb + sharpen * (pb - mb)))),
                        ma,  # alpha stays the median's — the stabler silhouette
                    )
    else:
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
    m = matted(raw)
    img = Image.open(m or raw)
    # A matted raw already carries the alpha; flooding it again would only walk
    # the transparent region it already has.
    if not m:
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
#   contrast Averaging pulls every tone toward the local mean, so the fewer
#            pixels a shape gets the flatter it comes out. The coarser the grid,
#            the harder the survivors have to work — this is what puts the
#            shelves back in the bookshelf and the teeth back on the gears.
#
#   sharpen  How far the median is pulled back toward a raw point sample. The
#            median is not what washes the result out — a median is always a value
#            that was really there — it is the 3x box step in front of it, which
#            means away the darkest and brightest thirds of every cell before the
#            median gets to vote. This puts that range back. Swept at 36: 0.35 is
#            a clear lift, 0.55 starts speckling the boss, 0.8 is confetti.
STEP_TUNE = {
    144: {"colors": 32, "contrast": 1.00, "sharpen": 0.00},
    72: {"colors": 24, "contrast": 1.05, "sharpen": 0.40},
    36: {"colors": 16, "contrast": 1.12, "sharpen": 0.40},
    18: {"colors": 16, "contrast": 1.22, "sharpen": 0.40},
}


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
    m = matted(raw)
    img = Image.open(m or raw)
    if not m:
        img = knock_out_background(img)
    img = crop_to_content(img)
    img = punch(img, tune["contrast"])
    img = to_pixel_grid(img, fh - pad, tune["colors"], target_w=fw - pad,
                        median=True, sharpen=tune["sharpen"])
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
    ap.add_argument("--regen", type=int, default=0, metavar="N",
                    help="generate fresh raws with a coarse prompt aimed at an NxN sprite")
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
        env = load_keys() if args.regen else {}
        for step in steps:
            print(f"step {step} -> {step_dir(step).relative_to(ROOT)}"
                  + (f"  (regenerating coarse raws at c{args.regen})" if args.regen else ""))
            for a in assets:
                if args.regen:
                    generate(a, env, args.force, args.regen)
                # A density-specific raw wins when one exists: it was composed for a
                # coarse grid, which the 144 raw was not.
                raw = raw_path(a["id"], args.regen) if args.regen else raw_path(a["id"])
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
