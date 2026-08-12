// PostHog product analytics (EU cloud) — drop into src/systems/analytics.ts.
// The contract every ai-asylum game keeps:
//   - no VITE_POSTHOG_KEY ⇒ every call is a safe no-op (dev logs to console)
//   - autocapture OFF (game HUD is noise), pageview/pageleave ON
//   - session replay armed but NOT started: call enableSessionReplay() only on
//     a device tier that can afford it — low-end phones pay zero
//   - anonymous only (identified_only, never call identify())
//   - localStorage persistence (WebView-friendly, no cookies)
//   - telemetry must NEVER throw into gameplay
import posthog from "posthog-js";

type Props = Record<string, unknown>;

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const KEY = env["VITE_POSTHOG_KEY"];
const HOST = env["VITE_POSTHOG_HOST"] || "https://eu.i.posthog.com";
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

let ready = false;

/** Bring analytics up once, early in boot. No-op (dev: console) without a key. */
export function initAnalytics(): void {
  if (ready) return;
  if (!KEY) {
    if (DEV) console.info("[analytics] no VITE_POSTHOG_KEY — events log to console only");
    return;
  }
  try {
    posthog.init(KEY, {
      api_host: HOST,
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      person_profiles: "identified_only",
      persistence: "localStorage",
    });
    ready = true;
  } catch (err) {
    console.warn("[analytics] init failed:", err);
  }
}

/** Start DOM session replay — call only on a capable device tier. */
export function enableSessionReplay(): void {
  if (!ready) return;
  try {
    posthog.startSessionRecording();
  } catch {
    /* never let telemetry throw into gameplay */
  }
}

/** Record a product event. Safe to call before init or without a key. */
export function track(event: string, props?: Props): void {
  if (!ready) {
    if (DEV && !KEY) console.debug("[analytics]", event, props ?? {});
    return;
  }
  try {
    posthog.capture(event, props);
  } catch {
    /* swallow */
  }
}
