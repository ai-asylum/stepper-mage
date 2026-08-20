/**
 * The five ingredient glyphs the belt strip draws in its pouches.
 *
 * Its own file for the reason `treeIcons.ts` is: this is ART, not layout. `ui/hud.ts`
 * decides where a pouch goes and what state it is in and asks here for the drawing.
 * Same contract as that file too — every glyph is a Canvas 2D path, no image assets,
 * authored in NORMALISED units so one number (`s`, the glyph's half-extent) scales
 * the set from a 22px loop to a 30px one without re-tuning anything.
 *
 * The rules are the star tree's rules, and they were paid for there:
 *
 *  1. **SILHOUETTE first, detail never.** The strip's loops are ~24px tall — smaller
 *     than any tree disc — so the five are separated by outline alone: a dome under a
 *     spark, a tied bundle, a bellied flask, a fan of arrowheads, an hourglass. No two
 *     share a bounding shape, and nothing in the set is told apart by texture.
 *  2. **Where two are in the same family, the difference is a COUNT.** Coffin Moss and
 *     Multishot are the pair at risk — both are three things leaving one point — so
 *     moss gets a solid tie band at its waist and blunt leaves, Multishot gets sharp
 *     heads and no band. `docs/DESIGN.md` prices Multishot as "three targets", so the
 *     three is the semantics rather than decoration.
 *  3. **Every glyph has a fallback.** Below `s = 7` a two-letter monogram is drawn
 *     instead. No supported stage width reaches that today (a 295px SE still gets
 *     `s = 11`), but a narrower one would.
 *
 * Each glyph is a small cousin of the CARD FACE the same ingredient arrives in your
 * hand on (`spells/ingredientCards.ts`): the summoning spark over waking clay, the
 * hourglass, the ascending chevron. The hand and the belt have to be recognisably the
 * same object, and a pouch that looks nothing like the card it produces is two
 * different items to the player.
 */

const TAU = Math.PI * 2;

/**
 * One glyph, centred on the origin and bounded by `[-s, s]` on both axes. The caller
 * has already set `fillStyle`, `strokeStyle`, `lineCap` and `lineJoin` — the same
 * contract as `treeIcons.Icon`, deliberately, so the two sets stay interchangeable in
 * review.
 */
export type BeltIcon = (ctx: CanvasRenderingContext2D, s: number) => void;

const line = (
  ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

/**
 * A four-pointed spark with concave sides.
 *
 * Repeated here rather than shared out of `treeIcons.ts`: the two files are separate
 * art sets on purpose and exporting a primitive between them would couple every future
 * tweak of a tree glyph to a belt glyph. It is eight lines.
 */
function spark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Deeply concave: at `0.28` the four points filled out into a plain diamond at 22px,
  // and a diamond over a dome reads as a chess pawn.
  const w = r * 0.15;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + w, cy - w, cx + r, cy);
  ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + r);
  ctx.quadraticCurveTo(cx - w, cy + w, cx - r, cy);
  ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - r);
  ctx.closePath();
  ctx.fill();
}

/**
 * Object animation: a mound heaving out of the ground with the summoning spark over
 * it.
 *
 * The mound is the OBJECT — the ingredient's whole job is that the body comes from
 * the room — and it is the only filled dome in the set, so the silhouette is "wide
 * base, single point on top" and nothing else here is that. A blocky crate was tried
 * first and read as a coffin, which is the neighbouring ingredient.
 */
const animate: BeltIcon = (ctx, s) => {
  const gy = s * 0.82;
  // Flat and WIDE — 1.9:1. A dome as tall as it is round read as a bead; at this ratio
  // it is a lump of the floor lifting, which is what the ingredient does.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, gy, s * 0.84, s * 0.46, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // the ground it is coming out of, heavy enough to see at 22px
  ctx.lineWidth = Math.max(1.4, s * 0.16);
  line(ctx, -s * 0.96, gy, s * 0.96, gy);
  // Held clear of the mound, so the two are two marks and not one silhouette.
  spark(ctx, 0, -s * 0.42, s * 0.56);
};

/** A blunt leaf, laid along `(dx, dy)`. Filled, so a bundle reads heavy at the tips. */
function leaf(
  ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, r: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.46, Math.atan2(dy, dx), 0, TAU);
  ctx.fill();
}

/**
 * Coffin Moss: a bundle, tied.
 *
 * `docs/DESIGN.md` calls the filled states "vials and bundles", and this is the bundle.
 * HUNG, tie at the top and the leaves falling out of it, which is what a bunch of cut
 * greenery does and what fixes the two problems the upright version had at 22px: tied
 * at the waist it read as a potted plant, and fanning upward out of one point it was the
 * same gesture as Multishot's spray. Bottom-heavy with a solid bar above it is a
 * silhouette nothing else in the set has.
 *
 * Not a coffin, though the ingredient is named for one: `treeIcons.ts` already found
 * that a tapered box this small reads as any other tapered box.
 */
const moss: BeltIcon = (ctx, s) => {
  // the tie it hangs by
  ctx.fillRect(-s * 0.34, -s * 0.94, s * 0.68, s * 0.2);
  ctx.lineWidth = Math.max(1.2, s * 0.16);
  // Leaves fat enough to BE the silhouette. Thin sprigs disappear at this size.
  for (const [dx, dy, k] of [[-1, 0.52, 0.92], [0.05, 1, 1], [1, 0.46, 0.88]] as const) {
    const tx = dx * s * 0.46, ty = -s * 0.66 + dy * s * 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.quadraticCurveTo(dx * s * 0.12, ty * 0.45, tx, ty);
    ctx.stroke();
    leaf(ctx, tx + dx * s * 0.18, ty + dy * s * 0.2, dx, dy, s * 0.4 * k);
  }
};

/** The glass, traced once so it can be both stroked and used as a clip. */
function flaskPath(ctx: CanvasRenderingContext2D, s: number): void {
  const nw = s * 0.2, ny = -s * 0.58, bw = s * 0.62, by = s * 0.9;
  ctx.beginPath();
  ctx.moveTo(-nw, ny);
  ctx.lineTo(-nw, -s * 0.22);
  ctx.quadraticCurveTo(-bw, s * 0.04, -bw * 0.9, s * 0.48);
  ctx.quadraticCurveTo(-bw * 0.74, by, 0, by);
  ctx.quadraticCurveTo(bw * 0.74, by, bw * 0.9, s * 0.48);
  ctx.quadraticCurveTo(bw, s * 0.04, nw, -s * 0.22);
  ctx.lineTo(nw, ny);
}

/**
 * Growth: a bellied flask, nearly full, with the ascending chevron over its mouth.
 *
 * A VIAL and not a plant, and that is the deliberate half. Growth's card face is a
 * sprout, and a sprout beside Coffin Moss's bundle is two green plants — the exact
 * mud `treeIcons.ts` warns about. The flask keeps the pairing legible while the
 * chevron, which the card wears too, keeps the meaning ("more, bigger") on the glyph
 * rather than only in the colour.
 */
const grow: BeltIcon = (ctx, s) => {
  ctx.lineWidth = Math.max(1.2, s * 0.14);
  // the level, clipped to the glass
  ctx.save();
  flaskPath(ctx, s);
  ctx.clip();
  ctx.globalAlpha *= 0.5;
  ctx.fillRect(-s, -s * 0.02, s * 2, s);
  ctx.restore();
  flaskPath(ctx, s);
  ctx.stroke();
  // the stopper, filled — it is what fixes the shape as a bottle and not a bulb
  ctx.fillRect(-s * 0.32, -s * 0.76, s * 0.64, s * 0.2);
  ctx.lineWidth = Math.max(1.1, s * 0.13);
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, -s * 0.72);
  ctx.lineTo(0, -s * 0.98);
  ctx.lineTo(s * 0.34, -s * 0.72);
  ctx.stroke();
};

/**
 * Multishot: one cast leaving as three.
 *
 * The COUNT is the glyph, which is what `docs/DESIGN.md` sells the ingredient as. The
 * heads are sharp triangles and there is no band anywhere on it — those two marks are
 * the whole of what tells this fan from the moss bundle's at 24px.
 */
const split: BeltIcon = (ctx, s) => {
  ctx.lineWidth = Math.max(1.1, s * 0.12);
  const oy = s * 0.78;
  for (const a of [-0.62, 0, 0.62]) {
    const tx = Math.sin(a) * s * 1.0, ty = oy - Math.cos(a) * s * 1.42;
    line(ctx, 0, oy, tx, ty);
    const h = Math.atan2(ty - oy, tx), hs = s * 0.3;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(h) * hs * 0.55, ty + Math.sin(h) * hs * 0.55);
    ctx.lineTo(tx + Math.cos(h + 2.5) * hs, ty + Math.sin(h + 2.5) * hs);
    ctx.lineTo(tx + Math.cos(h - 2.5) * hs, ty + Math.sin(h - 2.5) * hs);
    ctx.closePath();
    ctx.fill();
  }
  // three out of ONE: the origin is the half of the reading that says "split"
  ctx.beginPath();
  ctx.arc(0, oy, s * 0.15, 0, TAU);
  ctx.fill();
};

/**
 * TimeSand: the hourglass, most of it already through.
 *
 * Two solid horizontal caps with a pinched waist between them — the only glyph in the
 * set with a bar at BOTH ends, which is what keeps it away from Growth's flask (one
 * stopper, flat bottom) and from the moss tie (one bar, fan above).
 */
const sand: BeltIcon = (ctx, s) => {
  const w = s * 0.54, h = s * 0.7;
  // the heap already fallen, and what is left up top
  ctx.save();
  ctx.globalAlpha *= 0.85;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.14);
  ctx.lineTo(w * 0.9, h);
  ctx.lineTo(-w * 0.9, h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha *= 0.45;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.14);
  ctx.lineTo(w * 0.44, -h * 0.64);
  ctx.lineTo(-w * 0.44, -h * 0.64);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // the frame
  ctx.fillRect(-w * 1.2, -h * 1.36, w * 2.4, s * 0.19);
  ctx.fillRect(-w * 1.2, h * 1.17, w * 2.4, s * 0.19);
  ctx.lineWidth = Math.max(1, s * 0.12);
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sg * w, -h * 1.17);
    ctx.lineTo(sg * w * 0.1, 0);
    ctx.lineTo(sg * w, h * 1.17);
    ctx.stroke();
  }
  // one grain still running, so the glass is working and not empty
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.09, 0, TAU);
  ctx.fill();
};

/**
 * Every ingredient's drawing, keyed by the id the belt holds it under.
 *
 * Not `Record<string, …>` by accident: `animate`'s id is a working name the designer
 * still owns (`spells.ts`), so this is keyed off the same strings `INGREDIENT_IDS`
 * yields and a rename shows up as a missing glyph in one place rather than five.
 */
/**
 * THE HARVESTED SUBSTANCES, which the belt now holds beside its ingredients.
 *
 * Drawn rather than lettered because a pouch is read at a glance and mid-fight: `WA`
 * and `OI` are two dark marks that have to be parsed, and a droplet and a flame are
 * recognised without reading. Each is one silhouette in the substance's own colour,
 * on the same terms as the ingredient glyphs above — no outline, no detail that dies
 * at 16px.
 */
const droplet: BeltIcon = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.78, -s * 0.1, s * 0.62, s * 0.86, 0, s * 0.86);
  ctx.bezierCurveTo(-s * 0.62, s * 0.86, -s * 0.78, -s * 0.1, 0, -s);
  ctx.fill();
};

const flame: BeltIcon = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.7, -s * 0.3, s * 0.5, s * 0.9, 0, s * 0.9);
  ctx.bezierCurveTo(-s * 0.5, s * 0.9, -s * 0.7, -s * 0.2, -s * 0.15, -s * 0.45);
  ctx.bezierCurveTo(-s * 0.05, -s * 0.7, 0, -s * 0.85, 0, -s);
  ctx.fill();
};

/** A blunt wedge of rock: flat-bottomed, so it reads as heavy. */
const rock: BeltIcon = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, s * 0.7);
  ctx.lineTo(-s * 0.5, -s * 0.4);
  ctx.lineTo(s * 0.1, -s * 0.85);
  ctx.lineTo(s * 0.85, -s * 0.1);
  ctx.lineTo(s * 0.7, s * 0.7);
  ctx.closePath();
  ctx.fill();
};

/** Four-pointed star, the one shape in the set with no mass to it. */
const star: BeltIcon = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.16, -s * 0.16, s, 0);
  ctx.quadraticCurveTo(s * 0.16, s * 0.16, 0, s);
  ctx.quadraticCurveTo(-s * 0.16, s * 0.16, -s, 0);
  ctx.quadraticCurveTo(-s * 0.16, -s * 0.16, 0, -s);
  ctx.fill();
};

const ICON: Readonly<Record<string, BeltIcon>> = {
  animate, moss, grow, split, sand,
  // Oil is the droplet too — the COLOUR is what separates it from water, the same way
  // the ground already tells a slick from a puddle.
  water: droplet, oil: droplet, flame, stone: rock, starlight: star,
};

/** Two characters, for a loop too small to hold a drawing. Never normally seen. */
const MONOGRAM: Readonly<Record<string, string>> = {
  animate: 'AN', moss: 'MO', grow: 'GR', split: 'MS', sand: 'SA',
  water: 'WA', oil: 'OI', flame: 'FL', stone: 'ST', starlight: 'SL',
};

/**
 * Draw ingredient `id`'s glyph at `(cx, cy)` with half-extent `s`.
 *
 * Below `s = 7` the drawing is replaced by its monogram, for `treeIcons.ts`'s reason:
 * a bad drawing is worse than a word. An unknown id falls through to a monogram too
 * rather than drawing nothing, so a sixth ingredient shows up as a legible placeholder
 * instead of an empty loop.
 */
export function drawBeltIcon(
  ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, s: number, colour: string,
): void {
  const g = ICON[id];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (g && s >= 7) g(ctx, s);
  else {
    ctx.font = `bold ${Math.max(6, Math.round(s * 1.1))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MONOGRAM[id] ?? '??', 0, s * 0.06);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
  ctx.restore();
}
