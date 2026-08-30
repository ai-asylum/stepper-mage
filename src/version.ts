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
declare const __BUILD_NO__: string;
declare const __BUILT__: string;
declare const __OTA_VERSION__: string;

/**
 * THE NUMBER TO SAY OUT LOUD, e.g. `244`.
 *
 * The same integer Play calls `versionCode` — `git rev-list --count HEAD` — so
 * the app, the Play Console and a sentence in chat all name the build the same
 * way. `BUILD` below stays for the cases where exactness matters (which commit,
 * built when); this is the one a person can remember and repeat.
 */
export const BUILD_NO: string = typeof __BUILD_NO__ === 'string' ? __BUILD_NO__ : '?';

/**
 * WHEN this build was made, in words: `30 Aug 2026`.
 *
 * The commit hash that used to lead this line is gone. `BUILD_NO` names the code
 * exactly and a person can repeat it; a hash is precise and unreadable, and having
 * both on screen meant the unreadable one was the first thing the eye landed on.
 */
export const BUILT: string = typeof __BUILT__ === 'string' ? __BUILT__ : 'dev';

/**
 * The OTA bundle version from `ota-version.json` — the number the updater
 * compares against the running bundle. This is the value that answers "which
 * bundle am I on", where `BUILD` answers "which commit made it".
 */
export const OTA_VERSION: string = typeof __OTA_VERSION__ === 'string' ? __OTA_VERSION__ : 'dev';
