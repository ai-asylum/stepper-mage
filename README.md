# Stepper Mage

A mobile-first, first-person **dungeon stepper** where you have no weapons and no
armour — only a spellbook. You leaf through a physical grimoire with your thumb,
**tear pages out**, and fuse them into a single cast aimed at whatever is in front
of you. Animating the room is the core verb: a bookshelf becomes a Book Golem, a
water barrel becomes a Water Golem, and they fight for you.

Built on the spell system from [`ai-asylum/spellbook`](https://github.com/ai-asylum/spellbook).
The grimoire itself (`src/book/`) is ported near-verbatim from that project — the
paper-curl shader, the canvas-painted pages, the tear, the fanned hand — so it
stays mergeable with upstream. `src/book/bridge.ts` is the compatibility shim.

## The idea

Spellbook resolves a cast from the **distinct set** of pages you tear out:
authored fusions get names, and everything else composes systematically
(`Giant …`, `… Volley`, `Greater`/`Mighty`). This game adds one rule —
**the target is an ingredient**. `Animate` aimed at a bookshelf produces a Book
Golem; add Fireball to the same tear and you get a *Cinder* Book Golem whose
touch sets things alight. That is why every prop in every room is a spell
component rather than scenery.

There is no mana. A cast costs you a **turn**, and every turn hands the room a
free action back.

## Running it

```bash
npm install
npm run dev          # http://localhost:5199
npm run build
```

## The playable ad

```bash
npm run build:playable                       # → ads/playable/index.html
npx playable-smoke ads/playable/index.html   # headless behavioural check
```

One self-contained HTML file running the **real game** — `playable.html` boots
`src/playable/`, which imports `src/main.ts` unchanged and layers the ad chrome
on top. Sprites are embedded as data URIs by the manifest in
`scripts/build-playable.mjs` and resolved through `playable-kit/runtime`, so the
creative makes no network requests while the web build is byte-for-byte the same
fetch path it always was.

The creative ships under the real name, **Spelltorn Deep** — the repo, the game
and the HUD still say Stepper Mage, which is the working title.

The CTA is an **in-world interruption, never a screen change**. On whichever of
**15 seconds or 15 turns** comes first it takes the grimoire's half of the
frame, raises the wordmark in the room above it, and offers a dismiss sitting
exactly on the spellbook tab — so dismissing and re-opening the book are the
same target in the same place. Shutting the spellbook frees that space and
brings the offer straight back. Only a terminal state (death, or clearing the
last floor) gets a full end card.

Both the wordmark and the button plates are **procedural pixel art**
(`src/playable/art.ts`), drawn with the game's own `Pix` toolkit at art
resolution and upscaled by a whole-number factor — they cost bytes of code, not
bytes of payload, which is the right trade inside a 5 MB creative.

The build/embed/verify pipeline is [`ai-asylum/playable-kit`](https://github.com/ai-asylum/playable-kit),
vendored as a tarball in `vendor/` (never a `github:` dep — npm resolves those
over ssh on CI runners, where there is no key). The kit owns the parts that must
not drift per game, above all **`build.target: 'es2020'`**: ad WebViews are an
old fleet, es2021+ syntax parse-errors there, and the whole creative dies before
line one while impressions keep billing.

> **The CTA is a placeholder.** Stepper Mage has no `capacitor.config.*` and no
> Play listing, so there is no real appId. The build warns about this every run.
> Set `PLAYABLE_APP_ID=<real.package.id>` before any campaign upload — and never
> point it at the fake door, which detours the click out of store attribution.

Useful harnesses:

```bash
node tools/shot.mjs --tour      # screenshots from vantage points worth judging
node tools/playtest.mjs         # scripted run through the core loop
```

## Art

Everything is generated. Wall, floor and ceiling textures are **procedural pixel
art** drawn on canvas per floor theme (`src/art/`), so each of the five floors has
its own palette, light colour and detail vocabulary. Creatures, props, bosses and
golem forms are **AI-generated sprites** resampled onto a true pixel grid:

```bash
uv run --with Pillow python tools/genart.py          # generate anything missing
uv run --with Pillow python tools/genart.py --post   # re-resample cached raws
```

`art/manifest.json` is the content bible — one row per sprite. Raws are cached in
`art/_work/` (git-ignored), so sprite pixel sizes can be retuned without paying
for regeneration.

## Layout

| Path | What |
|---|---|
| `src/core/` | engine (low-res world + crisp overlay pass), RNG, feel primitives |
| `src/art/` | pixel toolkit, procedural masonry, floor themes |
| `src/dungeon/` | grid + generation, geometry, 2.5D billboard sprites |
| `src/spells/` | spell data, fusion resolution, cast VFX |
| `src/book/` | the grimoire, ported from `ai-asylum/spellbook` |
| `src/game/` | floors, population, stepper movement, turn-based combat |
| `src/ui/` | HUD, minimap, targeting |
| `src/playable/` | ad-only shell: CTA, end card, analytics (not in the web build) |
