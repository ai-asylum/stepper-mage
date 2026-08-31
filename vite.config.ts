import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
// @ts-expect-error — a plain .mjs helper, shared with the OTA publisher so the
// stamp and the served bundle can never name different versions.
import { otaVersion } from './scripts/ota-version.mjs';

/**
 * WHICH BUILD IS THIS — resolved at build time and inlined.
 *
 * The stamp is shown in the settings panel (`src/version.ts`), and it exists for
 * OTA: an installed app can be running the bundle inside the AAB or any web
 * bundle it has downloaded since, and from the outside those are identical. With
 * no stamp on screen, "did the update land" is unanswerable and every OTA test is
 * a guess.
 *
 * `define` rather than a post-build rewrite of the emitted JS: these become
 * compile-time constants, so minification cannot rename them out from under a
 * regex and there is no step that can silently no-op.
 *
 * Neither lookup may fail the build. A Vercel build has no usable git history —
 * the same trap that broke the OTA version scheme — so the commit falls back to
 * the CI-provided env var and then to a marker.
 */

/**
 * THE BUILD NUMBER — the one number that is the same everywhere.
 *
 * `versionCode` in the Play Console is `git rev-list --count HEAD`, so the commit
 * count IS the build number the store shows, and making the app print the same
 * thing means the number on the screen, the number in the Console and the number
 * in a bug report are one number. A short commit hash is exact and impossible to
 * hold in your head; "build 244" is both.
 *
 * A shallow clone counts 1, which is worse than useless because it looks like a
 * real answer — so both CI workflows check out with `fetch-depth: 0`, and a count
 * that comes back as 1 or fails outright is reported as `?` rather than as a lie.
 */
const buildNo = (() => {
  try {
    const n = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim());
    return Number.isFinite(n) && n > 1 ? String(n) : '?';
  } catch {
    return '?';
  }
})();

/**
 * WHEN, in words. No hash.
 *
 * The stamp used to lead with `commit` and the ISO minute, which is precise and
 * unreadable — a seven-character hash is not something anyone can carry from a
 * phone screen to a sentence. `BUILD n` names the code exactly (the count is
 * one-to-one with a commit on main) and a date says how fresh it is, which is the
 * only other thing a person ever wants off this line.
 *
 * Formatted by hand rather than through `toLocaleDateString`, because CI's locale
 * is nobody's choice and a stamp reading 8/30/2026 to a British user is the same
 * class of wrong as the hash was.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const builtOn = (() => {
  const d = new Date();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
})();

/**
 * The bundle version this build publishes, for the settings stamp.
 *
 * Through the SAME derivation the publisher uses (`scripts/ota-version.mjs`), or
 * the number on the screen and the number being served are two opinions and the
 * one place they are compared — "did the update land" — cannot answer. It used to
 * read `version` out of `ota-version.json`, which is the field that went stale for
 * eleven builds and no longer exists.
 *
 * A stamp is diagnostic, so a version that cannot be derived shows "unknown" here.
 * The publisher treats the same case as a hard error, because publishing a bundle
 * nobody can name is how the first attempt shipped 0.1.0 to everyone.
 */
const otaVersionStamp = otaVersion() ?? 'unknown';

export default defineConfig({
  base: './',
  server: { host: true, port: 5199 },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  define: {
    __BUILD_NO__: JSON.stringify(buildNo),
    __BUILT__: JSON.stringify(builtOn),
    __OTA_VERSION__: JSON.stringify(otaVersionStamp),
  },
});
