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
    },
  },
};

export default config;
