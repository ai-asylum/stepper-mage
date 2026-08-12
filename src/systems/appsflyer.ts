// AppsFlyer install attribution (MMP) — drop into src/systems/appsflyer.ts.
// Same contract as analytics: no VITE_APPSFLYER_DEV_KEY ⇒ no-op. Runs ONLY in
// the Capacitor native app (the plugin has no web implementation) — the guard
// keeps it off the web/fake-door deploys regardless of build flags.
// Wire in main.ts with a dynamic import so the web bundle never pulls it in:
//   void import("./systems/appsflyer").then((m) => m.initAppsFlyer());
import { Capacitor } from "@capacitor/core";

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const DEV_KEY = env["VITE_APPSFLYER_DEV_KEY"];
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

let ready = false;

/** Start AppsFlyer once, early in boot. Native-only; no-op without a dev key. */
export async function initAppsFlyer(): Promise<void> {
  if (ready) return;
  if (!Capacitor.isNativePlatform()) return; // browser / fake-door: skip entirely
  if (!DEV_KEY) {
    if (DEV) console.info("[appsflyer] no VITE_APPSFLYER_DEV_KEY — attribution disabled");
    return;
  }
  try {
    // Lazy import so the web bundle never pulls in the native plugin.
    const { AppsFlyer } = await import("appsflyer-capacitor-plugin");
    await AppsFlyer.initSDK({
      devKey: DEV_KEY,
      appID: "", // iOS App Store id — unused on Android-only apps
      isDebug: DEV,
      minTimeBetweenSessions: 6,
      registerConversionListener: false,
      registerOnAppOpenAttribution: false,
    });
    ready = true;
  } catch (err) {
    if (DEV) console.warn("[appsflyer] init failed", err);
  }
}
