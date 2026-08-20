/**
 * Over-the-air web-bundle updates for the Capacitor Android shell.
 *
 * The AAB packages `dist/` (see `capacitor.config.ts`'s `webDir`), so without
 * this a web-only fix — a balance number, a softlock, a broken altar card —
 * needs a Play submission and a Play review to reach anyone who has installed
 * the game. The plugin checks our own endpoint (`api/updates.js`) on launch,
 * downloads a newer bundle in the background, and serves it on the next start;
 * the copy inside the AAB stays as the fallback.
 *
 * Everything here is a no-op in the browser. The plugin has a web
 * implementation but nothing to update — the browser already has the newest
 * bundle the moment Vercel finishes deploying.
 *
 * The download and the swap are `autoUpdate`, configured in
 * `capacitor.config.ts` and handled entirely inside the plugin. The one thing
 * that has to happen in game code is `notifyBootOk`.
 */
import { Capacitor } from "@capacitor/core";

/**
 * Mark the running bundle as good.
 *
 * The updater installs a downloaded bundle optimistically and starts a timer
 * (`appReadyTimeout`, 10s). If `notifyAppReady()` has not been called by then it
 * assumes the bundle is broken and reverts to the previous one — which for a
 * first update is the copy inside the AAB. So a bundle that throws on boot rolls
 * itself back instead of leaving players on a white screen.
 *
 * Because that is a LIVENESS check, it has to fire on every successful boot,
 * including boots of the packaged bundle. Skipping it when no update is staged
 * would make the very first OTA look broken and get itself reverted.
 *
 * Call it once the game is actually playable, not at the top of boot: the point
 * is to certify that this bundle runs, and a call made before the first floor
 * exists certifies nothing.
 */
export async function notifyBootOk(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    // Never let update plumbing break the game. The worst case if this throws is
    // the updater reverting to the packaged bundle, which is a working build.
    console.warn("[live-updates] notifyAppReady failed", err);
  }
}
