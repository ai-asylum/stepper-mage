// Self-hosted update endpoint for @capgo/capacitor-updater.
//
// The plugin POSTs the running app's state here on launch and expects either a
// bundle to download or a no-update reply. Contract (Capgo self-hosted docs):
//
//   request  { version_name, version_build, version_os, custom_id, is_prod,
//              is_emulator, plugin_version, platform, app_id, device_id }
//   response { version, url, checksum }        -> download and stage this bundle
//              { message }                     -> nothing to do / refused
//
// The bundle and its manifest are produced by scripts/build-ota-bundle.mjs and
// served as static files from the same deployment, so a bundle can never be
// advertised by one deployment and fetched from another.
//
// Ported from ai-asylum/match-merge, which runs this in production. Two things
// are deliberately identical: the index is read per request (a redeploy is
// picked up without a cold start) and a missing index answers 200 rather than
// an error, because "no bundle published yet" is the normal state.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isNewer, bundleRunsOn } from "../src/shared/version.js";

// Only ever serve updates for this app. device_id/app_id come from an
// unauthenticated client, so they are treated as untrusted input — app_id is
// the one field worth gating on, and everything else is ignored.
const APP_ID = "games.misaligned.unbounddescent";

// The comparison decides whether every installed app downloads a bundle or none
// of them do, and the app needs the same rule to tell the player when a bundle
// is held back on their APK. Re-exported so callers and tests keep importing it
// from here.
export { isNewer, bundleRunsOn };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // The plugin only ever POSTs. A GET is a human poking at the URL, so answer
    // usefully rather than with a bare 405.
    res.status(405).json({ message: "POST only — this is the Capgo update endpoint" });
    return;
  }

  let index;
  try {
    // Bundled into the deployment next to dist/. Read per request rather than
    // at module load so a redeploy is picked up without a cold start.
    const indexPath =
      process.env.OTA_INDEX_PATH || join(process.cwd(), "dist/ota/index.json");
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    // No bundle published yet. This is a normal state, not an error — the app
    // keeps running the copy packaged in the AAB.
    res.status(200).json({ message: "no update available" });
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  if (body.app_id && body.app_id !== APP_ID) {
    res.status(200).json({ message: "unknown app" });
    return;
  }

  const current = body.version_name || "0.0.0";

  // Which bundle this caller is entitled to.
  //
  // Beta is always a choice: the player turned Beta updates on, which sets
  // custom_id. Nothing is inferred from the build a device happens to be on —
  // installing from the internal track is not consent to run untested code, and
  // a versionCode cannot be withdrawn once installed.
  const custom = typeof body.custom_id === "string" ? body.custom_id.trim().toLowerCase() : "";
  // `beta` is null whenever nothing is being tested, which is the normal state.
  // Falling back to `public` is what makes that state safe: without it an
  // opted-in device resolves to nothing and is told there is no update — not
  // once, but on every launch forever, while everyone else moves on. Opting into
  // beta must never mean receiving less than the public release.
  const wanted = custom === "beta" ? (index.beta || index.public) : index.public;

  if (!wanted) {
    // No public release yet: everyone who has not opted in stays on the bundle
    // inside their AAB, which is the version they installed from the store.
    logDecision(body, "no bundle for this audience");
    res.status(200).json({ message: "no update available" });
    return;
  }

  const bundle = (index.bundles || []).find((b) => b && b.version === wanted);
  if (!bundle) {
    // The pointer names a version that is no longer hosted — it aged out of
    // `keep`. Serving nothing is right: the alternative is a download that 404s
    // on the device.
    logDecision(body, `pointer names unhosted ${wanted}`);
    res.status(200).json({ message: "no update available" });
    return;
  }

  if (!isNewer(bundle.version, current)) {
    logDecision(body, `up to date (has ${current}, offered ${bundle.version})`);
    res.status(200).json({ message: "up to date" });
    return;
  }

  // Does this APK have the native code the bundle needs?
  //
  // `version_build` is the APK's versionName — confirmed against real device
  // logs, where it reads "1.0" while version_name carries the bundle version. A
  // bundle that depends on a plugin, permission or Capacitor config the
  // installed shell does not have will not fail politely: it fails whenever the
  // missing thing is first touched, which can be minutes into a run and looks
  // like a crash. Refusing it here is the only place that can stop it, because
  // the plugin's check runs natively before any of the app's own JavaScript.
  if (!bundleRunsOn(bundle, body.version_build)) {
    logDecision(
      body,
      `held back (${bundle.version} needs native ${bundle.min_native}, ` +
        `device has ${body.version_build ?? "unknown"})`,
    );
    // Still a 200 with a message: the plugin treats anything else as an error
    // and retries. The app surfaces the "update from the store" prompt itself,
    // by reading min_native out of the published index.
    res.status(200).json({ message: "app update required" });
    return;
  }

  // Absolute URLs built from this request's own host, so one origin serves every
  // version and a preview deployment serves its own bundles.
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  // The per-file manifest is what keeps an update to the size of what changed.
  // The plugin compares each entry against the builtin bundle and its local
  // cache and downloads only what it cannot reuse — so a release that touches
  // the JavaScript and leaves the art alone costs kilobytes, not the whole
  // bundle. Blobs are content-addressed, so an asset shipped inside the AAB is
  // already a match and is never fetched.
  //
  // The manifest can be switched off from ota-version.json without a new build.
  // It is the newer, more complex path — the plugin assembles the bundle file by
  // file — and when an update silently fails to arrive, being able to fall back
  // to the plain zip from the server side is what separates "delta is broken"
  // from "updates are broken", in one deploy rather than one Play build.
  const useDelta = index.delta !== false;
  const fileManifest = !useDelta ? [] : (bundle.files || []).map((f) => ({
    file_name: f.file_name,
    file_hash: f.file_hash,
    download_url: `${origin}/ota/blobs/${f.file_hash}`,
  }));

  logDecision(body, `serving ${bundle.version}${useDelta ? "" : " (zip only)"}`, fileManifest.length);
  res.status(200).json({
    version: bundle.version,
    // Kept as the fallback for a device that cannot use the manifest path.
    url: `${origin}${bundle.path}`,
    checksum: bundle.checksum,
    ...(fileManifest.length > 0 ? { manifest: fileManifest } : {}),
  });
}

/**
 * One line per check, in the Vercel function log.
 *
 * The whole update path is invisible otherwise: a device that is refused looks
 * exactly like a device that never asked. match-merge burned an hour of its
 * first live test on that ambiguity — the channel was being dropped on restart
 * and nothing anywhere said so.
 *
 * Deliberately no device_id: the question is always "what did it ask for and
 * what did it get", never "which handset was it".
 *
 * @param {any} body @param {string} decision @param {number} [files]
 */
function logDecision(body, decision, files) {
  try {
    // eslint-disable-next-line no-console
    console.log(
      "[ota]",
      JSON.stringify({
        version_name: body?.version_name ?? null,
        version_build: body?.version_build ?? null,
        custom_id: body?.custom_id || "(none)",
        platform: body?.platform ?? null,
        decision,
        ...(files == null ? {} : { files }),
      }),
    );
  } catch {
    /* logging must never break the endpoint */
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
