/**
 * Types for `version.js`, which is plain JS so that `api/` (Node) and `src/`
 * (the WebView bundle) can share one copy of the comparison. Keep in step with
 * the JSDoc in that file.
 */

/** A bundle as it appears in the published `ota/index.json`. */
export interface OtaBundle {
  version: string;
  path: string;
  checksum: string;
  bytes: number;
  builtAt: string;
  /** Lowest APK versionName this bundle runs on. Absent means "runs anywhere". */
  min_native?: string;
  files: { file_name: string; file_hash: string; size: number }[];
}

/** The published index: which bundle each audience gets, and what is hosted. */
export interface OtaIndex {
  delta: boolean;
  beta: string | null;
  public: string | null;
  bundles: OtaBundle[];
}

export function isNewer(candidate: string, current: string): boolean;

export function bundleRunsOn(
  bundle: { min_native?: string | null } | null | undefined,
  nativeVersion: string | null | undefined,
): boolean;
