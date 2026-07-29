/**
 * Drop the built creative into the web deploy as `/playable.html`.
 *
 * Run after `vite build` and `build:playable` (see the `build:site` script) —
 * `dist/` is what Vercel serves, and the creative is otherwise only written to
 * `ads/playable/`, which is the campaign artifact rather than the site.
 */
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'ads', 'playable', 'index.html');
const dist = join(root, 'dist');

if (!existsSync(src)) throw new Error(`no creative at ${src} — run build:playable first`);
if (!existsSync(dist)) throw new Error(`no ${dist} — run build first`);

copyFileSync(src, join(dist, 'playable.html'));

/**
 * The creative's one allowed external reference is `mraid.js`, which real ad
 * containers inject. On the web there is nothing to inject it, so serve an
 * empty file: a 404 would hand the browser an HTML error page to parse as
 * JavaScript. Empty means `window.mraid` stays undefined and the CTA falls
 * through to `window.open`, which is the correct behaviour for a web preview.
 */
writeFileSync(join(dist, 'mraid.js'), '');

console.log('▸ dist/playable.html  (+ empty dist/mraid.js)');
