#!/usr/bin/env node
// Packages the built web bundle as an over-the-air update payload.
//
// The Android app ships dist/ inside the AAB (capacitor.config.ts's webDir), so
// a web-only fix normally needs a Play submission and a Play review to reach
// installed players. @capgo/capacitor-updater lets the app fetch a newer web
// bundle at launch instead — the packaged copy stays as the fallback, and the
// plugin rolls back to it if the new bundle never calls notifyAppReady().
//
// This writes, into the deployment that will serve them:
//   dist/ota/unbound-descent-<version>.zip   the web bundle
//   dist/ota/manifest.json                   version + sha256 + path, read by api/updates.js
//
// The zip must contain the web root at its TOP LEVEL (index.html at the root of
// the archive), not nested under a dist/ directory — the plugin unpacks it
// straight into the bundle directory it serves from.
//
// IMPORTANT: build this from the SAME `npm run build` whose env matches the
// Android build. The bundle carries build-time VITE_* values baked in, so a
// bundle built without VITE_POSTHOG_KEY silently turns analytics off for every
// player who takes the update.
//
// Ported from ai-asylum/match-merge, including the two mistakes it already made
// and fixed — see readVersion below.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const OTA_DIR = join(DIST, "ota");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

/**
 * The version the plugin compares against the running bundle.
 *
 * Read from a COMMITTED file rather than derived at build time, for two reasons
 * that both broke match-merge's first attempt:
 *
 *  1. It was `git rev-list --count HEAD`, but a Vercel build has no usable git
 *     history — the call failed, the fallback returned 0, and every bundle
 *     published as "0.1.0". Nothing would ever have updated twice.
 *  2. It must stay ABOVE the Android versionName ("1.0"). On a fresh install the
 *     plugin reports versionName as the running version, so a "0.1.x" bundle is
 *     never newer and is never offered.
 *
 * Committing it also makes publishing deliberate: redeploying the website does
 * not silently hand every installed player a fresh download.
 */
function readVersion() {
  if (process.env.OTA_VERSION) return process.env.OTA_VERSION;
  const { version } = JSON.parse(readFileSync(join(ROOT, "ota-version.json"), "utf8"));
  if (!/^\d+(\.\d+)*$/.test(version || "")) {
    throw new Error(`ota-version.json: "${version}" is not a dotted numeric version`);
  }
  return version;
}
const version = readVersion();

// Guard the invariant rather than trusting whoever edits the file next. Read out
// of build.gradle so it cannot drift from the number the app actually reports.
const gradle = readFileSync(join(ROOT, "android/app/build.gradle"), "utf8");
const NATIVE_VERSION_NAME = (gradle.match(/versionName\s+"([^"]+)"/) || [, "1.0"])[1];
function isAbove(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}
if (!isAbove(version, NATIVE_VERSION_NAME)) {
  console.error(
    `ota-version.json version "${version}" is not above the Android versionName ` +
      `"${NATIVE_VERSION_NAME}". The plugin reports versionName as the running ` +
      `version on a fresh install, so this bundle would never be offered.`,
  );
  process.exit(1);
}

if (!process.env.VITE_POSTHOG_KEY) {
  console.warn(
    "  ota: WARNING — built with no VITE_POSTHOG_KEY, so this bundle has\n" +
      "       analytics DISABLED. Installed apps that take this update will\n" +
      "       stop reporting. Set the same VITE_* values the Android build uses\n" +
      "       before publishing.",
  );
}

// Rebuild the ota dir from scratch, or the previous publish's zip is still
// sitting in dist/ota and gets swept into the new archive — every bundle would
// carry every bundle before it.
rmSync(OTA_DIR, { recursive: true, force: true });
mkdirSync(OTA_DIR, { recursive: true });

const zipName = `unbound-descent-${version}.zip`;
const zipPath = join(OTA_DIR, zipName);

// Excluded from the payload:
//   ota/*        the archive would otherwise include itself
//   store/*      Play listing art (screenshots, feature graphic) the game never
//                requests at runtime — it is in dist only because the web deploy
//                serves it
//   playable.html, mraid.js   the ad creative and its shim, likewise never
//                loaded by the game
// They stay in dist, so the website still serves them; this only trims what
// installed players download.
const EXCLUDE = ["ota/*", "store/*", "playable.html", "mraid.js"];

execFileSync(
  "zip",
  ["-r", "-q", "-9", zipPath, ".", "-x", ...EXCLUDE],
  { cwd: DIST, stdio: ["ignore", "inherit", "inherit"] },
);

const zipBytes = readFileSync(zipPath);
const checksum = createHash("sha256").update(zipBytes).digest("hex");

// Relative path: api/updates.js resolves it against the request's own origin, so
// the same manifest works on a preview deployment, the production alias and a
// local preview without being rebuilt per environment.
writeFileSync(
  join(OTA_DIR, "manifest.json"),
  `${JSON.stringify(
    {
      version,
      path: `/ota/${zipName}`,
      checksum,
      bytes: zipBytes.length,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`  ota: ${zipName} — ${(zipBytes.length / 1024 / 1024).toFixed(2)} MB, version ${version}`);
console.log(`  ota: sha256 ${checksum}`);
