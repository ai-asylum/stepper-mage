// @ts-check
/**
 * Content-addressed file store for OTA bundles.
 *
 * A bundle used to ship as one zip, so every update re-downloaded every asset —
 * the whole payload to change a few kilobytes of JavaScript. The art barely
 * changes between releases, so almost all of that was bytes the device already
 * had.
 *
 * Each file is stored once under its own sha256. Two versions that share a file
 * share its blob, so the plugin's manifest download fetches only what is
 * genuinely new: it compares each entry against the builtin bundle and its
 * local cache and skips anything it can reuse.
 *
 * Addressing by content rather than by path is what makes that work across
 * versions AND across the packaged bundle — an asset that shipped inside the
 * AAB has the same hash as the one in an OTA, so it is never fetched at all.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Paths inside dist that are not part of the web bundle.
 *
 * Must stay in step with EXCLUDE in build-ota-bundle.mjs, or the zip and the
 * manifest would describe different bundles: the plugin would assemble a set of
 * files the zip fallback does not contain, and which of the two a device used
 * would change what it was running.
 */
const NOT_BUNDLE = new Set(["ota", "store", "playable.html", "mraid.js"]);

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/**
 * @typedef {{ file_name: string, file_hash: string, size: number }} BlobEntry
 */

/**
 * Write every bundle file into `<otaDir>/blobs/<sha256>` and return the
 * manifest describing them.
 *
 * Paths in the manifest are bundle-relative and forward-slashed — the plugin
 * unpacks them into the bundle root, so they must match what the zip would have
 * contained.
 *
 * @param {string} distDir
 * @param {string} otaDir
 * @returns {Promise<BlobEntry[]>}
 */
export async function writeBlobs(distDir, otaDir) {
  const blobDir = join(otaDir, "blobs");
  await mkdir(blobDir, { recursive: true });

  /** @type {BlobEntry[]} */
  const entries = [];
  for await (const file of walk(distDir)) {
    const rel = relative(distDir, file).split(sep).join("/");
    if (NOT_BUNDLE.has(rel.split("/")[0])) continue;

    const buf = await readFile(file);
    const hash = createHash("sha256").update(buf).digest("hex");
    const dest = join(blobDir, hash);
    // Content-addressed: identical bytes are the same blob, so a file that
    // appears twice in a bundle — or is unchanged since the last release — is
    // written once and downloaded once.
    if (!existsSync(dest)) await writeFile(dest, buf);
    entries.push({ file_name: rel, file_hash: hash, size: buf.length });
  }
  entries.sort((a, b) => a.file_name.localeCompare(b.file_name));
  return entries;
}

/**
 * How much a device would download, given what it already holds.
 *
 * Used to report the real cost of an update at build time, because "25 MB
 * bundle" and "what an existing player actually fetches" are very different
 * numbers and only the second one matters.
 *
 * @param {BlobEntry[]} next
 * @param {BlobEntry[]} previous
 */
export function deltaBytes(next, previous) {
  const held = new Set(previous.map((e) => e.file_hash));
  let bytes = 0;
  let files = 0;
  for (const e of next) {
    if (held.has(e.file_hash)) continue;
    bytes += e.size;
    files += 1;
  }
  return { bytes, files, total: next.reduce((a, e) => a + e.size, 0) };
}
