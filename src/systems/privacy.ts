/**
 * What the player is allowed to know and do about their own data.
 *
 * Separate from `systems/analytics.ts` on purpose: that file is a verbatim copy
 * of the loadout library's reference module, and a future re-copy from the skill
 * would silently wipe anything added to it. Everything game-specific that needs
 * PostHog lives out here instead.
 */
import posthog from 'posthog-js';

/**
 * The pages the store listing points at, and the app has to point at the same
 * ones — a privacy policy reachable from Play but not from inside the game is a
 * policy the player cannot find at the moment they want it.
 *
 * ABSOLUTE, deliberately. Two reasons, both of which break a relative path:
 * Capacitor serves the app from `https://localhost/`, and `store/` is excluded
 * from the OTA payload, so after any over-the-air update the bundle on the
 * device does not contain these files at all.
 */
const SITE = 'https://stepper-mage.vercel.app';
export const PRIVACY_URL = `${SITE}/store/privacy.html`;
export const TERMS_URL = `${SITE}/store/terms.html`;
/**
 * The deletion page, with the anonymous id in the FRAGMENT.
 *
 * A fragment is never put on the wire and never lands in a `Referer` header, so
 * handing the id over this way does not leak it to anything in between — and it
 * saves the player transcribing a UUID by hand at the one moment they are
 * already annoyed. With analytics off there is no id and nothing to append.
 */
export function dataDeletionUrl(): string {
  const id = getAnonymousId();
  const base = `${SITE}/store/data-deletion.html`;
  return id ? `${base}#id=${encodeURIComponent(id)}` : base;
}

/**
 * The id every event this player sends is filed under, or null when analytics
 * never came up (no key, or a browser that refused storage).
 *
 * Anonymous and never identified — nobody calls `identify()` — so this is the
 * only handle that exists for "delete my data", which is exactly why it has to
 * be visible from inside the game rather than only in a policy document.
 */
export function getAnonymousId(): string | null {
  try {
    return posthog.get_distinct_id() ?? null;
  } catch {
    // get_distinct_id() throws when init never ran.
    return null;
  }
}

/**
 * Open one of the pages above.
 *
 * `_blank` rather than assigning `location`: this is a game, and navigating the
 * WebView away from it would end the run to read a policy. Capacitor sends a
 * `_blank` to the system browser on Android, so the game is still sitting there
 * when the player comes back.
 */
export function openExternal(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* a blocked popup must not take the settings panel down with it */
  }
}

/**
 * Put the id on the clipboard, so it can be pasted into the deletion form or an
 * email without being copied off a screen by eye.
 *
 * @returns whether it landed — the caller says so on screen, because a copy
 *   button that silently does nothing is worse than no copy button.
 */
export async function copyAnonymousId(): Promise<boolean> {
  const id = getAnonymousId();
  if (!id) return false;
  try {
    await navigator.clipboard.writeText(id);
    return true;
  } catch {
    return false;
  }
}
