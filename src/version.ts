/**
 * WHICH BUILD IS THIS.
 *
 * Shown in the settings panel so the running build is identifiable at a glance —
 * on a phone, with no cable and no logcat. It exists for OTA above all: an
 * installed app can be running the bundle packaged in the AAB or any web bundle
 * it has downloaded since (`src/systems/liveUpdates.ts`), and from the outside
 * those look the same. Without a stamp on screen, "did the update land" cannot be
 * answered and every OTA test is a guess.
 *
 * Both values are inlined by Vite's `define` (see `vite.config.ts`) rather than
 * written into this file by a build step, so nothing here is ever dirty in the
 * working tree and minification cannot break the substitution.
 *
 * `npm run dev` has no `define` for these in watch mode? It does — the same
 * config serves dev, so a dev run shows the working tree's own commit. That is
 * deliberate: the stamp should never read "dev" on a machine that can tell you
 * exactly which commit is running.
 */
declare const __BUILD__: string;
declare const __OTA_VERSION__: string;

/** Short commit plus UTC build minute, e.g. `45f3159 · 2026-08-20T12:36Z`. */
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

/**
 * The OTA bundle version from `ota-version.json` — the number the updater
 * compares against the running bundle. This is the value that answers "which
 * bundle am I on", where `BUILD` answers "which commit made it".
 */
export const OTA_VERSION: string = typeof __OTA_VERSION__ === 'string' ? __OTA_VERSION__ : 'dev';
