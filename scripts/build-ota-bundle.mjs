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
//   dist/ota/unbound-descent-<version>.zip   the whole bundle (fallback path)
//   dist/ota/blobs/<sha256>                  one file each, content-addressed
//   dist/ota/index.json                      what each audience gets, read by api/updates.js
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
// Ported from ai-asylum/match-merge, including the mistakes it already made and
// fixed — see readVersion and carryForward below.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { otaVersion, resolvePublic } from "./ota-version.mjs";
import { join } from "node:path";
import { writeBlobs, deltaBytes } from "./ota-blobs.mjs";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const OTA_DIR = join(DIST, "ota");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

/**
 * Which bundle each audience gets.
 *
 * `version` is what THIS build produces; `public` and `beta` are pointers at
 * bundles that already exist and are never what gets built here. Keeping them
 * separate is what makes promotion free: releasing a beta is `public: <same
 * number>, beta: null`, the number never moves, so no code changes and nothing
 * needs retesting.
 */
function readRelease() {
  const d = JSON.parse(readFileSync(join(ROOT, "ota-version.json"), "utf8"));
  return {
    delta: d.delta !== false,
    // null means there is no beta. Not "" and not the public version copied in
    // by hand — an explicit absence, so the default state is expressible.
    beta: d.beta == null ? null : String(d.beta),
    // "auto" resolves to whatever this build publishes; see `resolvePublic`.
    publicVersion: d.public,
    keep: Number.isFinite(Number(d.keep)) ? Math.max(1, Number(d.keep)) : 3,
    // Recorded PER BUNDLE, not globally: an old bundle carried forward keeps
    // whatever it was published with. A global value would retroactively claim
    // every hosted version needs the newest shell, which is both untrue and
    // exactly the kind of thing that strands installed players.
    minNative: d.minNative == null ? null : String(d.minNative),
  };
}

/** Where previously published bundles are fetched from. */
const LIVE_ORIGIN = process.env.OTA_LIVE_ORIGIN || "https://stepper-mage.vercel.app";

/**
 * Carry the previously published bundles forward into this deployment.
 *
 * A deploy rebuilds dist from scratch, so without this the only bundle that
 * exists is the one just built — every earlier version 404s the moment it is
 * replaced. That makes the `public` pointer unusable for anything but "the
 * newest build", and leaves nothing to roll back to.
 *
 * They are fetched over HTTP from the live site rather than rebuilt, because
 * they cannot be rebuilt: their source is an older commit. Fetching is also what
 * keeps every version on ONE origin — the bundle a device downloads comes from
 * the same host it asked, whichever version it is.
 *
 * Best-effort by design. A first deploy has nothing to copy, and a fetch that
 * fails must not take the deploy with it — the new bundle is still published,
 * and the worst case is an older version stopping being available.
 */
async function carryForward(keepCount, freshVersion) {
  let index = [];
  try {
    const res = await fetch(`${LIVE_ORIGIN}/ota/index.json`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      index = Array.isArray(data?.bundles) ? data.bundles : [];
    }
  } catch {
    console.warn("  ota: no live index to carry forward (first deploy?)");
    return [];
  }

  const kept = [];
  for (const b of index) {
    if (kept.length >= keepCount - 1) break;
    if (!b?.version || b.version === freshVersion) continue;
    const name = `unbound-descent-${b.version}.zip`;
    try {
      const res = await fetch(`${LIVE_ORIGIN}/ota/${name}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const sum = createHash("sha256").update(buf).digest("hex");
      // A bundle whose bytes no longer match what the index claims is not the
      // bundle anyone tested. Dropping it is better than serving it.
      if (b.checksum && sum !== b.checksum) {
        console.warn(`  ota: ${b.version} checksum drifted — not carried forward`);
        continue;
      }
      writeFileSync(join(OTA_DIR, name), buf);
      kept.push({ ...b, checksum: sum, bytes: buf.length });
      console.log(`  ota: carried forward ${b.version} (${(buf.length / 1048576).toFixed(1)} MB)`);
    } catch (e) {
      console.warn(`  ota: could not carry forward ${b.version}: ${e.message}`);
    }
  }
  return kept;
}

/**
 * The version the plugin compares against the running bundle.
 *
 * Derived — see `scripts/ota-version.mjs` for why that is safe now and why it was
 * not the first time. The short version: the count is available in CI since the
 * deploy workflow stopped checking out shallow, `1.0.<n>` is always above the
 * Android versionName by construction, and this REFUSES to publish rather than
 * falling back to a number nobody chose.
 *
 * What the committed file bought was making publishing deliberate. That is exactly
 * what went wrong: forgetting to bump it published nothing, silently, for eleven
 * builds. `public: "auto"` keeps the deliberate part where it belongs — on holding
 * a release BACK, not on letting one out.
 */
function readVersion() {
  const v = otaVersion();
  if (v === null) {
    console.error(
      "OTA: cannot derive a bundle version — `git rev-list --count HEAD` gave no\n" +
        "     usable answer (a shallow clone reports 1). REFUSING to publish rather\n" +
        "     than guessing: the last time this guessed it shipped 0.1.0 to everyone\n" +
        "     and nothing could ever update twice. Check out with fetch-depth: 0, or\n" +
        "     set OTA_VERSION explicitly.",
    );
    process.exit(1);
  }
  if (!/^\d+(\.\d+)*$/.test(v)) {
    throw new Error(`OTA_VERSION "${v}" is not a dotted numeric version`);
  }
  return v;
}
const version = readVersion();

// Guard the invariant rather than trusting whoever edits the file next. Read out
// of build.gradle so it cannot drift from the number the app actually reports —
// match-merge hardcodes this and has to remember to keep it in step.
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
// installed players download. Must stay in step with NOT_BUNDLE in
// ota-blobs.mjs, or the zip and the manifest would describe different bundles.
const EXCLUDE = ["ota/*", "store/*", "playable.html", "mraid.js"];

execFileSync(
  "zip",
  ["-r", "-q", "-9", zipPath, ".", "-x", ...EXCLUDE],
  { cwd: DIST, stdio: ["ignore", "inherit", "inherit"] },
);

const zipBytes = readFileSync(zipPath);
const checksum = createHash("sha256").update(zipBytes).digest("hex");

const { beta, publicVersion, keep, delta, minNative } = readRelease();

// Per-file manifest. This is what makes an update cost only what changed: the
// plugin compares each entry against the builtin bundle and its local cache and
// downloads nothing it already holds. The zip stays as the fallback for the case
// where a device cannot use the manifest path.
const files = await writeBlobs(DIST, OTA_DIR);

// Carry the previous versions forward so `public` can name a bundle that is not
// the newest build — otherwise promoting would publish whatever is on main right
// now rather than the thing that was tested.
const carried = await carryForward(keep, version);

const entry = {
  version,
  path: `/ota/${zipName}`,
  checksum,
  bytes: zipBytes.length,
  builtAt: new Date().toISOString(),
  // Snake case to match the rest of the manifest the plugin and endpoint read.
  ...(minNative ? { min_native: minNative } : {}),
  files,
};

// Newest first. `keep` bounds it, so blobs belonging to versions that fall off
// the end stop being referenced and are simply not carried forward again.
const bundles = [entry, ...carried].slice(0, keep);

/**
 * The pointer, resolved. `"auto"` becomes the version just built — which is what
 * makes shipping the default and holding back the deliberate act.
 */
const released = resolvePublic(publicVersion, version);

const index = {
  delta,
  beta,
  public: released,
  bundles: bundles.map((b) => ({
    version: b.version,
    path: b.path,
    checksum: b.checksum,
    bytes: b.bytes,
    builtAt: b.builtAt,
    // Preserved from whatever the bundle was published with. Bundles from before
    // this field existed simply have none, which reads as "runs anywhere" — the
    // only safe default for something already installed.
    ...(b.min_native ? { min_native: b.min_native } : {}),
    files: b.files ?? [],
  })),
};
writeFileSync(join(OTA_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`  ota: ${zipName} — ${mb(zipBytes.length)} MB, version ${version}`);
console.log(`  ota: sha256 ${checksum}`);
console.log(`  ota: ${files.length} files, ${mb(files.reduce((a, f) => a + f.size, 0))} MB unpacked`);

// The number that actually matters to a player on the previous version.
const prev = carried[0];
if (prev?.files?.length) {
  const d = deltaBytes(files, prev.files);
  console.log(
    `  ota: a device on ${prev.version} downloads ${d.files} file(s), ` +
      `${mb(d.bytes)} MB — not ${mb(d.total)} MB`,
  );
}
/**
 * THE DECISION, SAID OUT LOUD, on every single build.
 *
 * The omission that prompted all of this was invisible: nothing failed, nothing
 * warned, and the state — "publishing a version nobody will be offered" — was only
 * discoverable by reading a JSON file nobody had reason to open. It is on the
 * screen of every run now, and in the GitHub step summary, where it is impossible
 * to ship a deploy without it having been printed.
 */
const verdict = released === version
  ? `LIVE to everyone on their next launch`
  : released
    ? `NOT this build — devices are pinned to ${released} (a rollback, or a stale pin)`
    : `NOBODY: public is null, so no device is offered anything`;
const summary =
  `  ota: version=${version}  public=${released ?? "(none released)"}  ` +
  `beta=${beta ?? "(none)"}  ` +
  `minNative=${minNative ?? "(any)"}  delta=${delta ? "on" : "OFF (zip only)"}\n` +
  `  ota: ${verdict}`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### OTA\n\n- **publishes** \`${version}\`\n`
      + `- **public** \`${released ?? "null"}\`\n`
      + `- ${verdict}\n`,
  );
}
