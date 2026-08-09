/**
 * Turning a drawn page to gold.
 *
 * Its own module because BOTH sides need it and neither may import the other: the
 * altar draws a gilded offer (`offerCard.ts`) and the book draws the gilded page it
 * became (`pageTexture.ts`), and putting the pass in either one makes the pair
 * circular.
 */
import { Pix, Ramp, rgba } from '../art/pixel';

export const GOLD = rgba(217, 160, 60);
export const GOLD_HI = rgba(255, 224, 160);

/**
 * The gilt ramp, dark to bright, that a gilded page's tones are mapped onto.
 *
 * Wider than the parchment ramp it replaces, because it carries the page's INK as
 * well as its paper: the darkest step is the brown the ink becomes, the brightest is
 * the highlight on raised leaf.
 */
const GILT = new Ramp([
  0x2a1c08, 0x4a3410, 0x6b4c18, 0x946d24, 0xba8f38, 0xd9b45c, 0xf2d98c, 0xfff0c0,
]);

/**
 * Turn a drawn page to gold.
 *
 * A recolour of the finished FACE rather than a second drawing, which is what the
 * phase asked for: it survives every spell, every rank and every future change to the
 * page layout without doubling anything, and the same pass can gild the page in the
 * book so a golden page is gold for the whole run rather than only on the altar.
 *
 * Tone-mapped by luminance, so the title, the rule, the prose and the sigil ring keep
 * their relationships. Gold leaf is monochrome, and forcing the whole face onto one
 * ramp is what makes it read as one GILDED OBJECT rather than as a normal page tinted
 * yellow.
 *
 * The one exception is the SIGIL. Strongly saturated texels are left alone, because
 * the sigil's colour is how a spell is identified at a glance, and a gilded page whose
 * fire sigil had also gone gold would be unreadable.
 */
export function giltify(src: Pix): Pix {
  const p = src.clone();
  for (let i = 0; i < p.data.length; i++) {
    const c = p.data[i];
    const a = (c >>> 24) & 255;
    if (!a) continue;
    // Packed little-endian: R is the low byte, B is the high one.
    const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    // Saturation, cheaply. Paper and ink are near-neutral warm tones; a sigil is not.
    if (max > 40 && (max - min) / max > 0.45) continue;
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    p.data[i] = (a << 24) | (GILT.step(lum) & 0x00ffffff);
  }
  return p;
}

