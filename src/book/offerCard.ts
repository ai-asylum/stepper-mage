/**
 * The altar's offers, as objects rather than as rows in a list.
 *
 * `Roadmap/Altar_Screen.md`: the altar is the only place in a run where the player
 * makes a lasting choice, and it was presented as a settings menu — three stacked
 * rows of text with a coloured left edge. Everything else in this game is a physical
 * thing you can point at. A vertical list also reads as a RANKING, and these are
 * peers.
 *
 * Two objects, and the shape answers "is this a spell?" before a word is read:
 *  - a spell offer is a PAGE, the thing the player already tears out of the book;
 *  - anything else — stars, heals, rerolls, rank-ups, sacrifices — is a SCROLL.
 *
 * ## The page is the REAL page
 *
 * A first attempt authored a small lookalike — a sigil in a ring on a parchment
 * rectangle — and it was wrong for exactly the reason this phase exists. The settled
 * decision is that a spell offer *is* a spell-book page, the same art the grimoire
 * draws, because the player already knows what that object is and what it does. A
 * card that merely resembles a page has to be learnt all over again, and reads as a
 * worse version of something already seen.
 *
 * So `actionPage` is called directly, at the book's own 128×168, and the layout gives
 * it as much of the screen as there is.
 */
import { Pix, Ramp, rgba, type Col } from '../art/pixel';
import { drawCentered } from '../art/bitfont';
import { PIX_H, PIX_W, actionPage } from './pageTexture';
import { GOLD, GOLD_HI, giltify } from './giltify';
// The BOOK's spell record, not the cast system's — `actionPage` draws from the page
// data (school, colours, the gameId that seeds the parchment), and taking the same
// type it takes is what guarantees the offered page and the torn page are one sheet.
import type { SpellDef } from '../spells/pages';

export { PIX_W as CARD_W, PIX_H as CARD_H };


/**
 * A SPELL offer: the page itself.
 *
 * `index` is the page's position in the book, which is what seeds its parchment — so
 * passing the real one means the page offered and the page it becomes are the same
 * sheet, down to the foxing.
 *
 * `title` is the name the page carries AT THE RANK BEING OFFERED — a rank-2 fire page
 * is a Fireball and has to say so, or the card is a Flame sitting under a caption
 * about a Fireball. Omitted, the page prints its rank-1 name as before.
 */
export function pageCard(spell: SpellDef, index: number, golden: boolean, title?: string): Pix {
  const page = actionPage(spell, index, title);
  return golden ? giltify(page) : page;
}

/**
 * A NON-SPELL offer: a scroll.
 *
 * Stars, heals, vials, rank-ups and sacrifices are not pages and should not pretend
 * to be one. The same size and the same pixel hand, so it stands beside a page as a
 * peer; a different SILHOUETTE — rolled ends top and bottom, a narrower sheet, no
 * squared corners — so the three offers sort by shape before a word is read.
 */
/**
 * The SIGIL a scroll carries, drawn rather than typed.
 *
 * These were bitfont characters — `~` for a reroll, `*` for stars — set in a disc,
 * and at this size a tilde is a dash and an asterisk is a smudge. A glyph borrowed
 * from a text face is not an icon; it is a letter standing in for one, and the
 * player reads it as noise.
 *
 * Drawn at the sigil's own scale in the page's ink, so they sit in the same hand as
 * everything else on the card.
 */
function scrollSigil(p: Pix, kind: string, cx: number, cy: number, ink: Col, hi: Col): void {
  switch (kind) {
    case 'stars':
    case 'star': {
      // A four-point star with a long vertical, the same mark the HUD uses for the
      // star total — so the card and the counter name the same currency.
      p.taper(cx, cy - 14, cx, cy + 14, 1, 4, ink);
      p.taper(cx - 11, cy, cx + 11, cy, 1, 4, ink);
      p.ellipse(cx, cy, 3, 3, ink);
      p.ellipse(cx - 1, cy - 1, 1, 1, hi);
      break;
    }
    case 'heal': {
      // A cross of even arms — a dose, not a religious mark.
      p.rect(cx - 3, cy - 11, 7, 23, ink);
      p.rect(cx - 11, cy - 3, 23, 7, ink);
      p.rect(cx - 1, cy - 9, 2, 6, hi);
      break;
    }
    case 'rank':
    case 'upgrade': {
      // Two chevrons pointing up: a step, and there is always another one.
      for (const dy of [4, -6]) {
        p.taper(cx - 10, cy + dy + 5, cx, cy + dy - 4, 3, 3, ink);
        p.taper(cx + 10, cy + dy + 5, cx, cy + dy - 4, 3, 3, ink);
      }
      break;
    }
    case 'sacrifice': {
      // A page with a tear through it. The offer destroys one, and the icon says so
      // before the price line does.
      p.rect(cx - 9, cy - 12, 18, 24, ink);
      p.rect(cx - 7, cy - 10, 14, 20, hi);
      for (let y = -12; y <= 12; y++) {
        const j = Math.round(Math.sin(y * 0.8) * 2);
        p.set(cx + j, cy + y, ink);
        p.set(cx + j + 1, cy + y, ink);
      }
      break;
    }
    default: {
      p.ellipseFrame(cx, cy, 10, 10, ink);
      p.ellipse(cx, cy, 4, 4, ink);
    }
  }
}

export function scrollCard(colour: number, kind: string, label: string, golden = false): Pix {
  const p = new Pix(PIX_W, PIX_H);

  const PARCH = new Ramp([0xb08f5e, 0xc9a878, 0xdcc296, 0xe8d3ab, 0xf3e5c6]);
  const ink = rgba(51, 37, 63);
  const inkMid = rgba(88, 64, 102);

  // The sheet is INSET, because a scroll is narrower than the page beside it. That
  // difference is the whole tell, so it has to survive at a glance.
  const inset = 16;
  const top = 22, h = PIX_H - 44, w = PIX_W - inset * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      p.set(inset + x, top + y, PARCH.step(0.35 + Math.min(1, edge / 10) * 0.6));
    }
  }
  p.frame(inset, top, w, h, inkMid);

  // the two rolled ends: a bar running past the sheet's edge, lit along its top
  for (const y of [top - 13, top + h]) {
    p.rect(inset - 8, y, w + 16, 13, inkMid);
    p.rect(inset - 8, y + 2, w + 16, 2, PARCH.step(0.95));
    p.rect(inset - 8, y, 4, 13, ink);
    p.rect(inset + w + 4, y, 4, 13, ink);
  }

  const tint = rgba((colour >> 16) & 255, (colour >> 8) & 255, colour & 255);
  const cx = PIX_W / 2, cy = 76;
  p.ellipseFrame(cx, cy, 26, 26, inkMid);
  p.ellipseFrame(cx, cy, 22, 22, ink);
  p.ellipse(cx, cy, 18, 18, tint);
  scrollSigil(p, kind, cx, cy, ink, PARCH.step(0.95));

  drawCentered(p, label.toUpperCase(), cx, 118, ink);
  for (let x = inset + 14; x < PIX_W - inset - 14; x++) p.set(x, 132, inkMid);

  if (golden) {
    const g = giltify(p);
    // Picked-out corners on the rolled ends — the illuminated flourish, and only its.
    for (const [x, y, sx] of [
      [inset - 8, top - 13, 1], [PIX_W - inset + 4, top - 13, -1],
    ] as const) {
      for (let i = 0; i < 8; i++) g.set(x + sx * i, y, GOLD);
      g.set(x, y, GOLD_HI);
    }
    return g;
  }
  return p;
}
