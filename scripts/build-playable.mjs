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
 * asks for (`art/<id>.png`). The whole game is in the demo, so the manifest is
 * the whole sprite set; trimming the slice is what would trim this list.
 */
const assets = readdirSync(join(root, 'public', 'art'))
  .filter((f) => f.endsWith('.png'))
  .sort()
  .map((f) => ({ file: `public/art/${f}`, key: `art/${f}` }));

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
