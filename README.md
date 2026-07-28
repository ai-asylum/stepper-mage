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

Useful harnesses:

```bash
node tools/shot.mjs --tour      # screenshots from vantage points worth judging
node tools/playtest.mjs         # scripted run through the core loop
node tools/fullrun.mjs          # clears all five floors' bosses
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
