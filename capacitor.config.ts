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
     * `autoUpdate` with `directUpdate: false`: the plugin downloads in the
     * background and swaps on the NEXT start, so nobody's run is interrupted by a
     * bundle arriving mid-floor. `appReadyTimeout` is the rollback window — the
     * game calls `notifyAppReady()` once the first floor is built
     * (`src/systems/liveUpdates.ts`), and a bundle that never gets there reverts to
     * the copy inside the AAB.
     */
    CapacitorUpdater: {
      updateUrl: 'https://stepper-mage.vercel.app/api/updates',
      autoUpdate: true,
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
