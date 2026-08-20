import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

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
const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'nogit').slice(0, 7);
  }
})();

const otaVersion = (() => {
  try {
    return JSON.parse(readFileSync('ota-version.json', 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  base: './',
  server: { host: true, port: 5199 },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  define: {
    __BUILD__: JSON.stringify(`${commit} · ${new Date().toISOString().slice(0, 16)}Z`),
    __OTA_VERSION__: JSON.stringify(otaVersion),
  },
});
