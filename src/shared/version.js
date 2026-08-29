// @ts-check
/**
 * Dotted numeric version comparison, shared by the update endpoint and the app.
 *
 * It lives here rather than inside `api/updates.js` because both sides need it
 * and neither can import the other: `api/` runs on a Node server and pulls in
 * `node:fs`, the app runs in a WebView. Two copies of a comparator that decides
 * whether an update is delivered is exactly the kind of duplication that drifts
 * silently — one side would start offering a bundle the other refuses, and
 * nothing would report it.
 *
 * Plain JS with a hand-written `.d.ts` beside it, deliberately: `api/` is Node
 * and cannot import TypeScript, and the repo builds with `allowJs` off, so the
 * declaration file is what lets `src/` import this with types intact.
 */

/**
 * True when `candidate` is strictly newer than `current`.
 *
 * Segments compare numerically, so "1.0.10" beats "1.0.9" — a string compare
 * gets that backwards, and this is the bug that would silently strand every
 * installed player on the tenth release. Missing segments read as 0, so "1.0"
 * and "1.0.0" are equal rather than one being newer. Anything unparseable
 * becomes 0, which means a device reporting junk is treated as ancient and
 * offered the update, rather than being stranded on an old bundle forever.
 *
 * @param {string} candidate
 * @param {string} current
 * @returns {boolean}
 */
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

/**
 * Can an APK reporting `nativeVersion` run this bundle?
 *
 * A bundle is web code, but web code comes to depend on the native shell — a
 * plugin that was not in the old APK, a permission it never declared, a
 * Capacitor config it does not have. Shipping such a bundle to an old APK does
 * not fail politely; it fails at whatever moment the missing thing is first
 * touched, which may be minutes into a run and looks like a crash.
 *
 * A bundle with no `min_native` recorded runs everywhere. That is deliberate:
 * every bundle published before this field existed has none, and treating
 * "unknown" as "blocked" would strand every installed player at once.
 *
 * @param {{ min_native?: string | null } | null | undefined} bundle
 * @param {string | null | undefined} nativeVersion
 * @returns {boolean}
 */
export function bundleRunsOn(bundle, nativeVersion) {
  const min = bundle?.min_native;
  if (!min) return true;
  // Unknown native version: allow. The alternative is blocking a device whose
  // state we merely failed to read, which turns a reporting gap into a
  // permanent update outage.
  if (!nativeVersion) return true;
  return !isNewer(min, nativeVersion);
}
