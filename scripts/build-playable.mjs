/**
 * Stepper Mage playable ad → `ads/playable/index.html`.
 *
 *   npm run build:playable
 *   PLAYABLE_APP_ID=com.example.steppermage npm run build:playable
 *
 * This file holds only what is genuinely per-game: the asset manifest and the
 * store URL. Everything else — single-file inlining, es2020, the 5 MB budget —
 * lives in playable-kit so it cannot drift between games.
 */
import { buildPlayable } from 'playable-kit/build';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The CTA destination.
 *
 * Stepper Mage has no `capacitor.config.*` and no Play listing yet, so there is
 * no real appId to read. This placeholder keeps the URL in the right shape for
 * review, and the build shouts about it — but a creative carrying it MUST NOT
 * go to a network: an unattributable CTA burns the campaign's optimizer, and a
 * fake-door URL here is what cost traindefense 309 clicks for 1 install.
 */
const PLACEHOLDER_APP_ID = 'REPLACE.WITH.REAL.APPID';
const appId = process.env.PLAYABLE_APP_ID || PLACEHOLDER_APP_ID;
const storeUrl = `https://play.google.com/store/apps/details?id=${appId}`;

/**
 * Every sprite the game fetches at runtime, keyed by the path `loadSprite()`
 * asks for. The whole game is in the demo, so the manifest is the whole sprite
 * set; trimming the slice is what would trim this list.
 *
 * Every roster on disk is embedded, not just the default step's. The pixel-step
 * chip is on screen in the playable too, and `assetUrl` falls through to a plain
 * relative path when a key is missing — which inside a single inlined HTML file
 * is a guaranteed 404, so tapping the chip would have emptied the dungeon of
 * every creature. The extra rosters cost a few hundred KB between them against a
 * 5 MB budget, because each is a quarter of the pixels of the one above.
 *
 * The step directories are DISCOVERED rather than listed, so cutting a roster
 * (18's was generated and cut) is one `rm` and not also an edit here.
 */
const artDir = join(root, 'public', 'art');
const pngs = (dir) => readdirSync(join(artDir, dir)).filter((f) => f.endsWith('.png')).sort();
const steps = readdirSync(artDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^s\d+$/.test(d.name))
  .map((d) => d.name)
  .sort();
// The 144 roster in `public/art/` is NOT embedded. It is 2.6 MB of the 3.7 MB of
// art in the game and only one step reads it — 72 draws from s72, and 36 and 18
// both draw from s36 — so leaving it out costs the ad exactly one position on the
// pixel chip and buys back most of the budget. `availableSteps()` drops 144 to
// match, so nothing can ask for a file that is not here.
const assets = steps.flatMap((d) =>
  pngs(d).map((f) => ({ file: `public/art/${d}/${f}`, key: `art/${d}/${f}` })));

buildPlayable({
  root,
  config: 'vite.playable.config.ts',
  entry: 'playable.html',
  out: 'ads/playable/index.html',
  assets,
  globals: { __PLAYABLE_STORE_URL__: storeUrl },
});

if (appId === PLACEHOLDER_APP_ID) {
  console.warn(
    '\n⚠  CTA points at a PLACEHOLDER appId — this build is for review only.\n'
    + '   Set PLAYABLE_APP_ID=<real.package.id> before any campaign upload.\n',
  );
}
