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

from PIL import Image

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


def to_pixel_grid(img: Image.Image, target_h: int, colors: int) -> Image.Image:
    """Area-resample onto the true pixel grid, then quantise the palette."""
    w, h = img.size
    scale = target_h / h
    tw = max(1, round(w * scale))
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated asset ids")
    ap.add_argument("--force", action="store_true", help="regenerate existing raws")
    ap.add_argument("--post", action="store_true", help="post-process cached raws only")
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
