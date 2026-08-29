// PostHog product analytics (EU cloud) — drop into src/systems/analytics.ts.
// The contract every ai-asylum game keeps:
//   - no VITE_POSTHOG_KEY ⇒ every call is a safe no-op (dev logs to console)
//   - autocapture OFF (game HUD is noise), pageview/pageleave ON
//   - session replay armed but NOT started: call enableSessionReplay() only on
//     a device tier that can afford it — low-end phones pay zero
//   - anonymous only (never call identify()) — but person profiles are ALWAYS
//     on, because install attribution is stamped on the person (see below)
//   - localStorage persistence (WebView-friendly, no cookies)
//   - native_platform + app_platform / is_native_app + game_version registered
//     on every event
//   - telemetry must NEVER throw into gameplay
import { Capacitor } from "@capacitor/core";
import posthog from "posthog-js";

type Props = Record<string, unknown>;

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const KEY = env["VITE_POSTHOG_KEY"];
const HOST = env["VITE_POSTHOG_HOST"] || "https://eu.i.posthog.com";
// The build identity — the cohort axis for "did retention improve between
// releases?", the one question that doesn't care where the install came from.
// It is package.json's `version`, handed over at build time by the build script
// (`VITE_GAME_VERSION=${VITE_GAME_VERSION:-$npm_package_version} vite build`) —
// see SKILL.md step 3, which also covers the bit that makes it worth anything:
// BUMPING it on release.
//
// Committed, deliberately, rather than derived from the build: Vercel clones
// --depth=10, so a git commit count (what Play's versionCode uses) would read as
// "10" on every web deploy forever while CI's AAB reported the real number, and
// the two surfaces could never be compared. `"unversioned"` here means the build
// script line is missing.
const GAME_VERSION = env["VITE_GAME_VERSION"] || "unversioned";
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
      // EU, always. The fallback above is load-bearing: a build that shipped
      // without VITE_POSTHOG_HOST used to default to us.i.posthog.com, so its
      // events went to a US cloud the org has no project in while every
      // dashboard queried EU (infinite-kitchen, 2026).
      api_host: HOST,
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      // "always", NOT the "identified_only" default. Nobody here ever calls
      // identify(), and under identified_only PostHog drops person properties
      // from anonymous events — which is exactly what the AppsFlyer module
      // set-onces onto the person (af_status / af_media_source / af_campaign).
      // Person processing costs more per event than anonymous capture; being
      // able to say which campaign a retained player came from is what buys it.
      person_profiles: "always",
      persistence: "localStorage",
    });

    // Surface tagging. FOUNDRY's analytics splits store-app traffic from
    // browser traffic on these super properties and NOTHING else: the Capacitor
    // WebView's user agent is ordinary mobile Chrome, so there is no other
    // signal that tells them apart.
    //
    // Skip this and every Android event the game ever sends — app AND browser
    // alike — lands in the "unknown" bucket. Desktop and iOS still resolve,
    // which is what makes the omission look like "Android has no players"
    // rather than "Android is unmeasured". Super properties attach at capture
    // time, so it cannot be backfilled: whatever ships unlabelled stays
    // unlabelled forever.
    //
    // One build covers both. Capacitor reports at runtime which shell it is
    // in, so the web bundle and the APK are the same code.
    //
    // `native_platform` is the one FOUNDRY's platform filters actually test
    // (exact match on 'android' / 'ios' — see game-foundry lib/posthog.ts), so
    // do NOT rename it. It ships on web too, as 'web': one PostHog project per
    // game serves the public web deploy AND the Play bundle, and this is what
    // splits them.
    //
    // `game_version` rides along here because it is registered the same way and
    // for the same reason, but it is the opposite axis: it describes the BUILD,
    // not the surface, so web and app report the identical value and a retention
    // cohort can be cut by release without touching attribution at all.
    const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
    posthog.register({
      native_platform: platform,
      app_platform: platform === "android" || platform === "ios" ? platform : "web",
      is_native_app: Capacitor.isNativePlatform(),
      game_version: GAME_VERSION,
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
