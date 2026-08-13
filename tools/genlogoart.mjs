/**
 * Generate the logo emblem through Scenario.
 *
 *   node tools/genlogoart.mjs --out art/_work/raw/logo-a.png [--prompt "…"]
 *
 * ONE generation per run, deliberately. Generations are paid and batching a
 * sheet of four means paying for three you throw away — the house rule is
 * `--only <one-id>` for the same reason.
 *
 * No text in the prompt. Image models still letter unreliably, and the game
 * already has a wordmark renderer that is exactly on-style; the emblem gets
 * composited under it afterwards. This also keeps the output usable as an icon,
 * where text is illegible anyway.
 *
 * Credentials come from 1Password (`Scenario` in the Secrets vault) via the
 * wrapper below — never pasted, never written to disk.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The Scenario helpers live in the store-assets skill, outside this repo, so
// they are loaded by URL rather than imported by bare specifier.
const SCRIPTS = process.env.SKILL_SCRIPTS
  ?? `${process.env.HOME}/.claude/plugins/marketplaces/ai-asylum/plugins/edi/skills/store-assets/scripts`;
const { generate, download } = await import(pathToFileURL(`${SCRIPTS}/scenario.mjs`).href);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
    return a;
  }, []),
);

// The same style contract every sprite in the game goes through (tools/genart.py),
// so the logo reads as the same artist's hand as the dungeon.
const STYLE = '16-bit SNES-era pixel art, clean solid dark keyline outline around the '
  + 'whole subject, limited palette, dithered shading, strong readable silhouette, '
  + 'high contrast, no anti-aliasing';

const DEFAULT = [
  'Fantasy video game logo emblem: an ancient grimoire lying OPEN at the centre,',
  'thick leather cover, glowing parchment pages spread like wings, a small arcane',
  'sigil of violet light rising off the open pages.',
  'Surrounding the book, one element in each quarter:',
  'orange FLAMES licking up the left side,',
  'jagged pale-blue ICE crystals rising on the right side,',
  'swirling white-cyan WIND currents curling across the top,',
  'green leafy VINES with curling tendrils growing up from the bottom.',
  'Symmetrical centred emblem composition, the four elements framing the book,',
  'dramatic rim lighting, deep near-black background, rich saturated colour.',
  STYLE,
  'No text, no letters, no words, no watermark, no border frame.',
].join(' ');

const prompt = args.prompt || DEFAULT;
const out = resolve(args.out || 'art/_work/raw/logo-a.png');

console.log(`model  : ${process.env.SCENARIO_MODEL_ID || 'model_openai-gpt-image-2'}`);
console.log(`prompt : ${prompt.slice(0, 160)}…`);

const urls = await generate({
  prompt,
  width: 1024,
  height: 1024,
  quality: 'high',
});
console.log('→', await download(urls[0], out));
