import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "games.misaligned.unbounddescent", // org convention; no dashes/underscores
  appName: "Unbound Descent",
  webDir: "dist", // Vite build output; `npx cap sync` copies it into the shell
  android: {
    webContentsDebuggingEnabled: true, // chrome://inspect on device builds
  },
  plugins: {
    /**
     * OTA web-bundle updates, served by this repo's own `api/updates.js` off the
     * same Vercel deployment that hosts the site. A web-only fix reaches installed
     * players on their next launch instead of waiting on a Play review.
     *
     * `autoUpdate: false` — THE APP DRIVES THIS, and only one thing may.
     *
     * It was true, and the plugin then checked on foreground on its own while
     * `checkOnResume` was also forcing an immediate check. Two mechanisms, neither
     * able to see the other's `checking` guard, and the first real delivery proved
     * it: the device asked for 1.0.250 at 13:02:25, began downloading, was asked
     * AGAIN at 13:02:27 while that download was still in flight, and downloaded the
     * same bundle a second time. The player sees the update screen appear, vanish
     * and appear again, and pays for the bytes twice.
     *
     * The app's own path is the one worth keeping. The plugin's `directUpdate:
     * false` behaviour downloads in the background and swaps on some LATER start,
     * which from the player's side is indistinguishable from nothing happening —
     * that is why `fetchAndApplyNow` exists and why it reloads there and then.
     *
     * `appReadyTimeout` still applies to bundles we set ourselves: the game calls
     * `notifyAppReady()` once the first floor is built, and a bundle that never
     * gets there reverts to the copy inside the AAB.
     *
     * NOTE this lives in the NATIVE shell (`cap sync` writes it into the APK's
     * assets), so unlike everything else today it cannot arrive over OTA — it
     * takes a store build.
     */
    CapacitorUpdater: {
      updateUrl: 'https://stepper-mage.vercel.app/api/updates',
      autoUpdate: false,
      directUpdate: false,
      resetWhenUpdate: true,
      appReadyTimeout: 10000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      /**
       * The beta opt-in has to survive a restart.
       *
       * The plugin sends `custom_id` with every update check and this is what
       * makes it persist. Without it the channel is dropped on restart, so an
       * opted-in player silently falls back to public on the next launch — the
       * exact fault that cost match-merge an hour of its first live test,
       * because a device being quietly moved back to stable is indistinguishable
       * from one that was never opted in.
       */
      persistCustomId: true,
      /**
       * Where the plugin posts what actually happened on the handset.
       *
       * It defaults to plugin.capgo.app/stats, a service this project does not
       * use, so every device-side failure was being thrown away. See
       * `api/stats.js`.
       */
      statsUrl: 'https://stepper-mage.vercel.app/api/stats',
    },
  },
};

export default config;
