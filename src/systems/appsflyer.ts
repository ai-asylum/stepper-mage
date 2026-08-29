// AppsFlyer install attribution (MMP) — drop into src/systems/appsflyer.ts.
// Same contract as analytics: no VITE_APPSFLYER_DEV_KEY ⇒ no-op. Runs ONLY in
// the Capacitor native app (the plugin has no web implementation) — the guard
// keeps it off the web/fake-door deploys regardless of build flags.
// Wire in main.ts with a dynamic import so the web bundle never pulls it in:
//   void import("./systems/appsflyer").then((m) => m.initAppsFlyer());
//
// It also carries attribution ACROSS into PostHog, which is the only reason the
// two systems can answer one question ("did the campaign buy players who stay?"
// rather than "how many installs?" and "how many D1s?" side by side):
//   - first-launch af_status / media_source / campaign → super props + person
//   - PostHog's distinct_id → AppsFlyer CUID, so raw exports join to persons
import { Capacitor } from "@capacitor/core";
import posthog from "posthog-js";

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const DEV_KEY = env["VITE_APPSFLYER_DEV_KEY"];
// Analytics keeps the same no-key-no-op contract, so without this key posthog
// was never init'd and the stamping below has nowhere to land.
const POSTHOG_KEY = env["VITE_POSTHOG_KEY"];
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

// Install attribution is a property of the install, not of the session: stamp
// it once and never again, or a later relaunch's (empty) payload overwrites it.
const STAMPED = "af_attribution_stamped";

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
    const { AppsFlyer, AFConstants } = await import("appsflyer-capacitor-plugin");

    // Subscribe BEFORE initSDK. initSDK also STARTS the session (manualStart is
    // off), and the plugin's notifyListeners is fire-and-forget — a listener
    // added after the server answers hears nothing.
    AppsFlyer.addListener(AFConstants.CONVERSION_CALLBACK, (event) => {
      // The same callback carries onConversionDataFail, which has no `data`.
      if (event.callbackName !== AFConstants.onConversionDataSuccess) {
        if (DEV) console.warn("[appsflyer] conversion data failed", event);
        return;
      }
      stampAttribution((event.data ?? {}) as Record<string, unknown>);
    });

    await AppsFlyer.initSDK({
      devKey: DEV_KEY,
      appID: "", // iOS App Store id — unused on Android-only apps
      isDebug: DEV,
      minTimeBetweenSessions: 6,
      registerConversionListener: true, // false ⇒ the listener above never fires
      registerOnAppOpenAttribution: false,
    });
    ready = true;

    // The join key: same id on both sides, so an AppsFlyer raw-data export
    // (installs, CTIT, media source) can be joined to a PostHog person row by
    // customer_user_id. Set after start, so it lands on this session's events
    // rather than on the install record itself — a CUID on the install would
    // need manualStart, and an app that forgets to call startSDK() reports no
    // attribution at all, which is the worse failure.
    const distinctId = POSTHOG_KEY ? posthog.get_distinct_id() : "";
    if (distinctId) await AppsFlyer.setCustomerUserId({ cuid: distinctId });
  } catch (err) {
    if (DEV) console.warn("[appsflyer] init failed", err);
  }
}

/**
 * Carry first-launch attribution into PostHog.
 *
 * The timing is the whole reason this is shaped like this: conversion data
 * arrives ASYNC, a beat after first launch, by which time PostHog has already
 * sent `$pageview` (and probably the game's session-start). So it can never be
 * a property of the first event. Instead it goes on
 *   - super properties, which persist and ride every LATER event, and
 *   - the person, set-once, which is retroactive for the whole person and
 *     survives the app being reinstalled onto the same profile.
 * `person_profiles: "always"` in analytics.ts is what makes the person half
 * work for these never-identified players — don't switch it back.
 *
 * Only the first launch carries install attribution; every field is optional
 * (an organic install typically has af_status and nothing else).
 */
function stampAttribution(data: Record<string, unknown>): void {
  try {
    if (!POSTHOG_KEY) return;
    const firstLaunch = data["is_first_launch"];
    if (firstLaunch !== true && firstLaunch !== "true") return;
    if (localStorage.getItem(STAMPED)) return;

    const props: Record<string, string> = {};
    const put = (key: string, value: unknown) => {
      if (typeof value === "string" && value) props[key] = value;
    };
    put("af_status", data["af_status"]); // 'Organic' | 'Non-organic'
    put("af_media_source", data["media_source"]);
    put("af_campaign", data["campaign"]);
    if (!Object.keys(props).length) return;

    posthog.register(props); // every event from here on
    posthog.setPersonProperties(undefined, props); // $set_once — first touch wins
    localStorage.setItem(STAMPED, "1");
    if (DEV) console.info("[appsflyer] attribution stamped", props);
  } catch {
    /* attribution must never break the game (same rule as analytics) */
  }
}
