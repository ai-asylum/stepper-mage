import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "games.misaligned.unbounddescent", // org convention; no dashes/underscores
  appName: "Unbound Descent",
  webDir: "dist", // Vite build output; `npx cap sync` copies it into the shell
  android: {
    webContentsDebuggingEnabled: true, // chrome://inspect on device builds
  },
};

export default config;
