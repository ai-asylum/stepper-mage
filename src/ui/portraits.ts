/**
 * Wizard portraits, as plain images for the 2D HUD.
 *
 * A separate loader from `dungeon/sprites.ts` on purpose. That one builds THREE
 * textures for billboards in the world and resolves through the texel-density folders
 * (`art/s72/…`); a portrait is UI, so it lives at the flat `art/<id>.png` path and must
 * NOT change with the density setting — the density is a decision about how the dungeon
 * is drawn, and a picture of a person is not the dungeon.
 *
 * Fire-and-forget by design. `get` returns null until the image has decoded and the HUD
 * draws its frame either way, so a portrait arriving two frames late shifts nothing.
 * Drawing the frame and leaving the hole is right for the same reason the bestiary pill
 * hides until it has contents: a box that appears LATER moves the layout, and a box that
 * was always there just fills in.
 */

const cache = new Map<string, HTMLImageElement>();
/** Ids that failed to load, so a missing file is not retried every frame. */
const failed = new Set<string>();

/**
 * The decoded portrait for an asset id, or null if it is not ready.
 *
 * Starts the load on first ask rather than from a preload list, so the roster is the
 * only place that decides which portraits exist — adding a wizard to `wizards.ts` is
 * the whole change.
 */
export function portrait(id: string): HTMLImageElement | null {
  if (failed.has(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const img = new Image();
  img.onerror = () => { failed.add(id); cache.delete(id); };
  img.src = `art/${id}.png`;
  cache.set(id, img);
  return null;
}

/** Native portrait aspect, so callers can size a frame that needs no cropping at all. */
export const PORTRAIT_ASPECT = 66 / 98;

/**
 * Draw the WHOLE portrait inside a box, scaled to fit and centred. Never cropped.
 *
 * CONTAIN and not cover. Cropping was tried and it is wrong on a painted bust: the
 * composition is the picture, and shaving the shoulders to fill an arbitrary frame throws
 * away the part that makes it read as a portrait rather than a mugshot. Callers should
 * size their frames to `PORTRAIT_ASPECT` so there is nothing to letterbox in the first
 * place; where they cannot, the empty strip is the frame's problem and not the picture's.
 *
 * `imageSmoothingEnabled` is forced off around the blit and restored after. The rest of
 * the HUD is vector chrome that WANTS smoothing, so this cannot be set once globally —
 * and a smoothed pixel portrait beside the dungeon's hard pixels is the exact "two pixel
 * sizes at once" tell that `tools/genart.py` resamples the raws to avoid.
 */
export function drawPortrait(
  ctx: CanvasRenderingContext2D, id: string,
  x: number, y: number, w: number, h: number,
): boolean {
  const img = portrait(id);
  if (!img) return false;
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = Math.round(img.naturalWidth * scale);
  const dh = Math.round(img.naturalHeight * scale);
  const dx = Math.round(x + (w - dw) / 2);
  const dy = Math.round(y + (h - dh) / 2);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = smooth;
  return true;
}
