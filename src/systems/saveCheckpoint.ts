/**
 * A known-good copy of the save, taken while the public bundle is running.
 *
 * Leaving the beta is a code DOWNGRADE: `reset()` drops back to the bundle
 * inside the AAB, which then reads storage that newer code wrote. `loadMeta` in
 * `main.ts` is shaped `try { parse } catch { return default }` — robust against
 * corruption, and therefore silent about a downgrade. If a beta ever changed the
 * shape of the meta save, the older bundle would not crash; it would read a
 * default, and the player's stars, roster and tree would simply be gone, with
 * nothing logged anywhere.
 *
 * So the checkpoint is taken at the only moment it is guaranteed to be readable
 * by the public bundle: while the public bundle is the one running. Snapshotting
 * on opt-in would not do — that fires when the player is already mid-beta on
 * some arbitrary bundle.
 *
 * Everything here takes a `Storage` so it can be exercised without a browser.
 *
 * Ported from ai-asylum/match-merge.
 */

/** Where the checkpoint lives. Excluded from its own snapshot. */
export const CHECKPOINT_KEY = 'stepper-mage.backup.public';
/** The save as it was at the moment of reverting, kept so it is recoverable. */
export const BETA_SAVE_KEY = 'stepper-mage.backup.beta';
/** The beta opt-in itself. Declared here because the exclusion below needs it. */
export const BETA_KEY = 'stepper-mage.updates.beta';

/**
 * Keys that must NOT travel in a checkpoint.
 *
 * The beta flag above all: restoring it would flip the player back into the beta
 * they just left. The backups themselves would nest copies inside copies.
 *
 * `stepper-mage.ftue.v1` is the subtle one, and it is here for the removal rule
 * rather than the restore rule. A checkpoint taken before that key existed does
 * not contain it, and `restoreCheckpoint` deletes keys the checkpoint does not
 * have — so reverting would clear the activation flag and make an existing
 * player fire `ftue_completed` a second time. Activation must be once per player
 * for the D0 column to mean anything, and a beta revert is not a new player.
 *
 * `stepper-mage.onboarding.v1` is there for exactly the same removal rule and the
 * same sentence: a checkpoint taken before the guided descent existed does not
 * carry the key, so reverting would sit a player who has already been taught
 * through the whole tutorial again. Unlike the activation flag it IS about the
 * save rather than the person — see `resetProgress`, which deliberately clears it
 * — but a beta revert is not a fresh save either.
 */
const EXCLUDED = new Set<string>([
  CHECKPOINT_KEY,
  BETA_SAVE_KEY,
  BETA_KEY,
  'stepper-mage.ftue.v1',
  'stepper-mage.onboarding.v1',
]);

/**
 * Is this one of the game's own save keys?
 *
 * Namespaced rather than "everything in localStorage": PostHog keeps its
 * `distinct_id` here and AppsFlyer its attribution stamp, and rolling either of
 * those back would either mint a new player or re-stamp an install. Neither
 * carries the prefix, so both are left alone by construction.
 */
function isSaveKey(k: string): boolean {
  return k.startsWith('stepper-mage.') && !EXCLUDED.has(k);
}

/** Read every save key into a plain object. */
export function collectSave(store: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !isSaveKey(k)) continue;
    const v = store.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}

/**
 * Write a checkpoint, stamped with the bundle that produced it.
 *
 * `at` is passed in rather than read from the clock, so this is testable.
 */
export function writeCheckpoint(store: Storage, bundle: string, at: number): boolean {
  try {
    store.setItem(CHECKPOINT_KEY, JSON.stringify({ bundle, at, keys: collectSave(store) }));
    return true;
  } catch {
    // Storage full or unavailable. The checkpoint is a safety net, not a
    // feature — failing to write one must never break the game.
    return false;
  }
}

export function readCheckpoint(
  store: Storage,
): { bundle: string; at: number; keys: Record<string, string> } | null {
  try {
    const raw = store.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    const rec = d as { bundle?: unknown; at?: unknown; keys?: unknown };
    if (!rec.keys || typeof rec.keys !== 'object') return null;
    return {
      bundle: String(rec.bundle ?? ''),
      at: Number(rec.at) || 0,
      keys: rec.keys as Record<string, string>,
    };
  } catch {
    return null;
  }
}

/**
 * Put the checkpoint back, keeping the current save aside first.
 *
 * The beta save is preserved rather than discarded because a player who reverts
 * and finds progress missing has one question — "where did it go" — and the
 * honest answer has to be recoverable, not "it is gone".
 *
 * Keys absent from the checkpoint but present now are removed: leaving a key the
 * public bundle has never seen is how a downgrade produces a half-migrated save
 * that neither version reads correctly.
 *
 * @returns whether anything was restored
 */
export function restoreCheckpoint(store: Storage): boolean {
  const cp = readCheckpoint(store);
  if (!cp) return false;
  const current = collectSave(store);
  try {
    store.setItem(BETA_SAVE_KEY, JSON.stringify({ at: cp.at, keys: current }));
  } catch {
    /* keeping the old save is best-effort; the restore below still matters */
  }
  for (const k of Object.keys(current)) {
    if (!(k in cp.keys)) store.removeItem(k);
  }
  for (const [k, v] of Object.entries(cp.keys)) store.setItem(k, v);
  return true;
}

/**
 * Would reverting lose anything the player would notice?
 *
 * Compared by value rather than by any schema number: the question a warning
 * needs to answer is "has my save changed since the last known-good copy", and
 * that is exactly a diff. A player who took a beta bundle and played nothing has
 * nothing to lose and should not be warned — a warning shown when nothing is at
 * stake teaches people to click through the one that matters.
 */
export function saveDivergedFromCheckpoint(store: Storage): boolean {
  const cp = readCheckpoint(store);
  if (!cp) return false;
  const now = collectSave(store);
  const keys = new Set([...Object.keys(cp.keys), ...Object.keys(now)]);
  for (const k of keys) {
    if (cp.keys[k] !== now[k]) return true;
  }
  return false;
}
