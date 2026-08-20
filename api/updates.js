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
// are deliberately identical: the manifest is read per request (a redeploy is
// picked up without a cold start) and a missing manifest answers 200 rather
// than an error, because "no bundle published yet" is the normal state.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Only ever serve updates for this app. device_id/app_id come from an
// unauthenticated client, so they are treated as untrusted input — app_id is
// the one field worth gating on, and everything else is ignored.
const APP_ID = "games.misaligned.unbounddescent";

// Compare dotted numeric versions without pulling in a semver dependency.
// Returns true when `candidate` is strictly newer than `current`. Exported for
// tests — this comparison is the part that decides whether every installed app
// downloads a bundle or none of them do.
export function isNewer(candidate, current) {
  const a = String(candidate).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(current).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // The plugin only ever POSTs. A GET is a human poking at the URL, so answer
    // usefully rather than with a bare 405.
    res.status(405).json({ message: "POST only — this is the Capgo update endpoint" });
    return;
  }

  let manifest;
  try {
    const manifestPath =
      process.env.OTA_MANIFEST_PATH || join(process.cwd(), "dist/ota/manifest.json");
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    res.status(200).json({ message: "no update available" });
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  if (body.app_id && body.app_id !== APP_ID) {
    res.status(200).json({ message: "unknown app" });
    return;
  }

  const current = body.version_name || "0.0.0";
  if (!isNewer(manifest.version, current)) {
    res.status(200).json({ message: "up to date" });
    return;
  }

  // Absolute URL built from this request's own host, so the manifest stays
  // environment-agnostic and a preview deployment serves its own bundle.
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;

  res.status(200).json({
    version: manifest.version,
    url: `${proto}://${host}${manifest.path}`,
    checksum: manifest.checksum,
  });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
