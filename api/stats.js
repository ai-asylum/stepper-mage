// @ts-check
/**
 * Sink for @capgo/capacitor-updater's device-side event stream.
 *
 * The plugin reports what actually happens on the handset — download_complete,
 * download_fail, checksum_fail, unzip_fail, set, set_fail, update_fail,
 * app_launch_timeout — and by default posts them to plugin.capgo.app/stats, a
 * service this project does not use. So every device-side failure was thrown
 * away, and debugging an update that "just doesn't arrive" meant guessing.
 *
 * That cost match-merge several builds: the server could be seen doing the right
 * thing while the device silently did nothing, and there was no way to tell
 * which of download, checksum, unzip or apply had failed.
 *
 * This just records them. It is deliberately not a database — the value is in
 * the Vercel function log next to the /api/updates decisions, so one stream
 * shows what a device was offered and what it then did with it.
 */

/** Fields worth keeping. The plugin sends more; this is what answers a why. */
const KEEP = [
  "action",
  "version_name",
  "old_version_name",
  "version_build",
  "version_os",
  "plugin_version",
  "platform",
  "custom_id",
];

/**
 * @param {import("node:http").IncomingMessage & { body?: unknown }} req
 * @param {import("node:http").ServerResponse & { status: Function, json: Function }} res
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "POST only — this is the Capgo stats endpoint" });
    return;
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    /** @type {Record<string, unknown>} */
    const line = {};
    for (const k of KEEP) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== "") line[k] = body[k];
    }
    // Anything the plugin adds that is not in KEEP but looks like a reason.
    if (body.message) line.message = String(body.message).slice(0, 300);
    // eslint-disable-next-line no-console
    console.log("[ota-stats]", JSON.stringify(line));
  } catch {
    // A malformed body is not worth failing over — the plugin retries stats and
    // a rejected one would just come back.
  }

  // Always 200. The plugin treats a failed stats post as worth retrying, and
  // nothing here is important enough to make a device retry anything.
  res.status(200).json({ ok: true });
}
