/**
 * WHICH BUNDLE VERSION THIS BUILD PUBLISHES — derived, so it cannot be forgotten.
 *
 * It used to be a number committed in `ota-version.json` and bumped by hand
 * "whenever web code changes, and only then". That is a duty, and duties get
 * skipped: builds 239 through 249 all changed the web bundle and all published as
 * 1.0.2, so every device asking "what is newest?" was told the version it already
 * had. The pipeline worked perfectly and delivered nothing for eleven builds.
 *
 * `1.0.<commit count>` removes the duty. It moves with the code by construction,
 * it is strictly increasing because the count is, and it is always above the
 * Android `versionName` of "1.0" — which matters because the plugin reports the
 * versionName as the running version on a fresh install, so a bundle numbered
 * below it is never newer and is never offered.
 *
 * WHY THIS WAS REVERTED ONCE, AND WHY IT IS SAFE NOW. The first attempt derived
 * the same way and broke: a Vercel build had no git history, the count failed, the
 * fallback returned 0, and every bundle published as "0.1.0" — nothing would ever
 * have updated twice. Two things changed. The deploy workflow now checks out with
 * `fetch-depth: 0` (the build stamp needs the same count), and this REFUSES rather
 * than guesses: `null` on failure, and the publisher treats null as a hard error.
 * A build that cannot name its bundle must not publish one.
 *
 * `OTA_VERSION` in the environment still overrides everything, for the rare case
 * of republishing a specific number by hand.
 */
import { execFileSync } from 'node:child_process';

/** The count, or null when it cannot be established. Never a guess. */
function commitCount() {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' });
    const n = Number(out.trim());
    // 1 is what a shallow clone reports, and it is indistinguishable from a real
    // answer — which is exactly how the old fallback shipped 0.1.0 to everyone.
    return Number.isFinite(n) && n > 1 ? n : null;
  } catch {
    return null;
  }
}

/**
 * The version this build publishes, or null if it cannot be derived.
 *
 * Callers decide what null means: the publisher stops, the inlined stamp shows
 * "unknown". A version is only load-bearing for the first of those.
 */
export function otaVersion() {
  if (process.env.OTA_VERSION) return process.env.OTA_VERSION;
  const n = commitCount();
  return n === null ? null : `1.0.${n}`;
}

/**
 * Resolve the `public` pointer from `ota-version.json`.
 *
 * `"auto"` means "the version this build publishes", and it is the default for the
 * reason the omission happened: the old default was `null`, which means NOBODY GETS
 * ANYTHING, so forgetting to touch the file shipped nothing and said nothing. Now
 * forgetting ships the build, and holding it back is the deliberate act — which is
 * the right way round for a field whose whole purpose is to deliver code.
 *
 * A dotted number still pins it, which is what a rollback is: name a version that
 * is still hosted and every device drops back to it. `null` still means nobody, for
 * when that is genuinely wanted.
 */
export function resolvePublic(raw, fresh) {
  if (raw == null) return null;
  const s = String(raw);
  return s === 'auto' ? fresh : s;
}
