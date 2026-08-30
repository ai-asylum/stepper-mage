/**
 * Over-the-air web-bundle updates for the Capacitor Android shell.
 *
 * The AAB packages `dist/` (see `capacitor.config.ts`'s `webDir`), so without
 * this a web-only fix — a balance number, a softlock, a broken altar card —
 * needs a Play submission and a Play review to reach anyone who has installed
 * the game. The plugin checks our own endpoint (`api/updates.js`) on launch,
 * downloads a newer bundle in the background, and serves it on the next start;
 * the copy inside the AAB stays as the fallback.
 *
 * Everything here is a no-op in the browser. The plugin has a web implementation
 * but nothing to update — the browser already has the newest bundle the moment
 * Vercel finishes deploying.
 *
 * Ported from ai-asylum/match-merge, which runs all of this in production. The
 * comments preserve the faults it hit, because each one was invisible until it
 * had cost a build.
 */
import { Capacitor } from '@capacitor/core';
import { track } from './analytics';
import { isNewer, bundleRunsOn } from '../shared/version.js';
import type { OtaIndex } from '../shared/version.js';
import {
  BETA_KEY,
  writeCheckpoint,
  restoreCheckpoint,
  saveDivergedFromCheckpoint,
} from './saveCheckpoint';

/**
 * Origin serving the published bundles and index.
 *
 * Must match the host in `capacitor.config.ts`'s `updateUrl` — the plugin
 * downloads from there, and this reads the index describing what it downloaded.
 * Two different hosts would mean the app reasoning about an index that does not
 * describe the bundle it is running.
 */
const OTA_ORIGIN = 'https://stepper-mage.vercel.app';

/**
 * What this device is RUNNING, learned at boot and quoted in failure reports.
 *
 * A failure event names the version being fetched but not the one already
 * installed, and "stuck on 1.0.11 and cannot move" versus "already current and
 * downloading anyway" are different faults with the same event. In match-merge
 * the second of those turned out to be happening and was invisible.
 */
let currentBundleVersion: string | null = null;
let currentNativeVersion: string | null = null;

/** The plugin, imported lazily so the web bundle never pulls the native code in. */
/**
 * Is the native updater actually registered in THIS shell?
 *
 * The web bundle and the native shell are versioned separately the moment OTA exists,
 * so a bundle that knows about the updater can end up running inside an APK built
 * before the plugin was added — or one where `cap sync` did not put it in
 * `capacitor.plugins.json`. Calling into it there throws Capacitor's "not implemented
 * on android", which the WebView surfaces to the PLAYER as an error on boot. From a
 * feature whose entire job is to be invisible.
 *
 * `isPluginAvailable` is the question Capacitor exposes for exactly this. It answers
 * false on the web too, which is where every one of these calls was already a no-op.
 */
export function updaterReady(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CapacitorUpdater');
}

/**
 * The plugin, BOXED — and the box is the whole point.
 *
 * A Capacitor plugin is a `Proxy` whose `get` trap answers EVERY property name with a
 * callable that dispatches to native (`@capacitor/core`, `createPluginMethodWrapper`);
 * only `$$typeof`, `toJSON`, `addListener` and `removeListener` are special-cased.
 * `then` is not among them.
 *
 * So returning the proxy from an `async` function hands it to `Promise.resolve`, which
 * asks whether it is a thenable by reading `.then` — gets a function, because everything
 * is a function here — and calls it. That is a bridge call to a native method named
 * `then`, which no plugin implements, and Capacitor throws
 * `"CapacitorUpdater.then()" is not implemented on android`. On EVERY path, on a shell
 * where the plugin is present and working, at boot, in the player's face.
 *
 * `updaterReady()` could never have caught it: the plugin was available the whole time.
 * The await was the bug. Boxed in a plain object, nothing reads `.then` off the proxy
 * and the await resolves to an ordinary value.
 */
type Updater = (typeof import('@capgo/capacitor-updater'))['CapacitorUpdater'];

async function updater(): Promise<{ api: Updater }> {
  // Guarded rather than trusted: every caller already handles a throw, but a throw the
  // player can see is not the same as one only the log sees.
  if (!updaterReady()) throw new Error('CapacitorUpdater is not available in this shell');
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  return { api: CapacitorUpdater };
}

/**
 * Mark the running bundle as good.
 *
 * The updater installs a downloaded bundle optimistically and starts a timer
 * (`appReadyTimeout`, 10s). If `notifyAppReady()` has not been called by then it
 * assumes the bundle is broken and reverts to the previous one — which for a
 * first update is the copy inside the AAB. So a bundle that throws on boot rolls
 * itself back instead of leaving players on a white screen.
 *
 * Because that is a LIVENESS check, it has to fire on every successful boot,
 * including boots of the packaged bundle. Skipping it when no update is staged
 * would make the very first OTA look broken and get itself reverted.
 *
 * Call it once the game is actually playable, not at the top of boot: the point
 * is to certify that this bundle runs, and a call made before the first floor
 * exists certifies nothing.
 */
export async function notifyBootOk(): Promise<void> {
  if (!updaterReady()) return;
  try {
    const { api: CapacitorUpdater } = await updater();
    await CapacitorUpdater.notifyAppReady();
    // The far end of the funnel below: this bundle not only installed, it booted
    // far enough to say so, which is the only thing that stops the rollback
    // timer. Carries which bundle, so a specific OTA that dies on launch is
    // identifiable rather than just a dip.
    let bundle: string | null = null;
    let native: string | null = null;
    try {
      const cur = await CapacitorUpdater.current();
      bundle = cur?.bundle?.version ?? null;
      native = cur?.native ?? null;
    } catch {
      // Version lookup is best-effort; the event is worth more than the label.
    }
    track('ota_boot_ok', { ota_bundle: bundle, ota_native: native });
    // Bookkeeping after the event, not before: the funnel event is the point of
    // this function, and nothing here may delay or precede it.
    currentBundleVersion = bundle;
    currentNativeVersion = native;
  } catch (err) {
    // Never let update plumbing break the game. The worst case if this throws is
    // the updater reverting to the packaged bundle, which is a working build.
    console.warn('[live-updates] notifyAppReady failed', err);
    track('ota_boot_notify_failed', { error_message: String(err).slice(0, 300) });
  }
}

/**
 * Report what the updater does, so a bad OTA is visible as a shape rather than
 * as an unexplained dip in DAU.
 *
 * An over-the-air update is the one thing here that can take a working installed
 * app and stop it working, on every device at once, without a store review in
 * the way. The plugin is built to survive that — an unhealthy bundle reverts to
 * the copy inside the AAB — but a silent revert and a silent success look
 * identical from the outside, and so does a bundle that downloads and never
 * applies.
 *
 * The funnel these events form:
 *
 *   ota_update_available  the server offered a newer bundle
 *   ota_download_complete it arrived intact and is staged for next launch
 *   ota_bundle_applied    the app actually started on it
 *   ota_boot_ok           it survived long enough to cancel the rollback
 *
 * Attrition between any two of those is the answer to "is the update dropping
 * players", and each step names the failure differently: a gap at download is
 * network or server, a gap at applied is the install, and a gap at boot_ok is
 * the bundle itself crashing on launch — the case that ends in a rollback the
 * player never sees.
 *
 * Every listener is wrapped: telemetry must not be able to break the updater it
 * is watching.
 */
export async function installUpdateTelemetry(): Promise<void> {
  if (!updaterReady()) return;
  try {
    const { api: CapacitorUpdater } = await updater();

    /**
     * Bind one plugin event to one analytics event. The names are translated
     * rather than passed through: the plugin's vocabulary is its own, and these
     * land in the same namespace as every other event the game sends.
     */
    const on = (
      pluginEvent: string,
      name: string,
      props?: (state: Record<string, never>) => Record<string, unknown>,
    ): void => {
      // The plugin's listener map is typed per event name; this bridge is
      // deliberately loose so an event the installed plugin version does not
      // know about is a no-op rather than a type error at every call site.
      const add = (
        CapacitorUpdater as unknown as {
          addListener: (e: string, cb: (s: unknown) => void) => Promise<unknown>;
        }
      ).addListener;
      add.call(CapacitorUpdater, pluginEvent, (state: unknown) => {
        try {
          track(name, props ? props((state ?? {}) as Record<string, never>) : {});
        } catch {
          /* swallow */
        }
      }).catch(() => {
        // A listener the installed plugin version does not know about is not
        // worth failing over — the rest still report.
      });
    };

    const version = (s: Record<string, never>): Record<string, unknown> => ({
      ota_bundle: (s as { bundle?: { version?: string } })?.bundle?.version ?? null,
    });

    on('updateAvailable', 'ota_update_available', version);
    on('downloadComplete', 'ota_download_complete', version);
    // `set` fires when a bundle becomes the one the app will run.
    on('set', 'ota_bundle_applied', version);
    on('appReloaded', 'ota_app_reloaded');
    on('noNeedUpdate', 'ota_no_update', version);
    // The two explicit failures. Worth separating: a download that never
    // finishes is the server or the network, an update that fails to apply is
    // the device.
    on('downloadFailed', 'ota_download_failed', (s) => ({
      ota_bundle: (s as { version?: string })?.version ?? null,
      ota_current: currentBundleVersion,
      ota_native: currentNativeVersion,
    }));
    on('updateFailed', 'ota_update_failed', (s) => ({
      ...version(s),
      ota_current: currentBundleVersion,
      ota_native: currentNativeVersion,
    }));
  } catch (err) {
    console.warn('[live-updates] update telemetry not installed', err);
  }
}

/**
 * Report download progress to the update screen.
 *
 * Separate from `installUpdateTelemetry` on purpose, even though both bind the
 * same plugin events. That one is analytics and must never be load-bearing —
 * every one of its listeners swallows and its failure is a warning. This one is
 * the only thing standing between the player and a progress bar that never
 * moves, so it is bound on its own and its failure is worth knowing about.
 *
 * `download` fires repeatedly with a percent; `downloadComplete` marks the end
 * of the bytes and the start of the part with nothing to report (set + reload).
 * Both failures lower the screen, because a failed update must not be able to
 * hold the game behind it — the automatic flow will try again on the next
 * launch, and the bundle already installed is a working game in the meantime.
 */
export async function onDownloadProgress(cbs: {
  onPercent: (pct: number) => void;
  onComplete?: () => void;
  onFailed?: () => void;
}): Promise<void> {
  if (!updaterReady()) return;
  try {
    const { api: CapacitorUpdater } = await updater();
    const add = (
      CapacitorUpdater as unknown as {
        addListener: (e: string, cb: (s: unknown) => void) => Promise<unknown>;
      }
    ).addListener;
    const bind = (event: string, fn: (s: unknown) => void): void => {
      add.call(CapacitorUpdater, event, (state: unknown) => {
        try { fn(state); } catch { /* the screen is not worth a crash */ }
      }).catch(() => {
        // An event this plugin version does not know about is not fatal: the
        // screen still raises and lowers, it just cannot draw the middle.
      });
    };
    bind('download', (s) => {
      const pct = (s as { percent?: number })?.percent;
      if (typeof pct === 'number') cbs.onPercent(pct);
    });
    bind('downloadComplete', () => cbs.onComplete?.());
    bind('downloadFailed', () => cbs.onFailed?.());
    bind('updateFailed', () => cbs.onFailed?.());
  } catch (err) {
    console.warn('[live-updates] progress listener not installed', err);
  }
}

// ===== Beta channel =====
//
// An OTA reaches players without store review, so a bundle can be held as
// beta-only until it is deliberately released. Nothing is inferred from the
// build a device happens to be on: installing from the internal track is not
// consent to run untested code, and a versionCode cannot be withdrawn once
// installed. So volunteers opt in with a switch.
//
// The plugin sends `custom_id` with every update check and persists it across
// restarts (`persistCustomId` in capacitor.config.ts), so setting it once is
// enough. `api/updates.js` reads it.

export { BETA_KEY };

/** Whether the player has opted into beta bundles. */
export function betaEnabled(): boolean {
  try {
    return localStorage.getItem(BETA_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Persist the choice and tell the updater.
 *
 * Written to storage even off-native so the toggle keeps its state in a browser,
 * where it is otherwise inert — the web build is always "latest" by definition,
 * so there is nothing for it to opt into.
 *
 * @returns whether a bundle was applied, so the caller can keep a loading screen
 *   up for the download and take it down again when nothing happened.
 */
export async function setBetaEnabled(on: boolean): Promise<boolean> {
  try {
    localStorage.setItem(BETA_KEY, on ? '1' : '0');
  } catch {
    /* private mode — the setCustomId below still applies for this session */
  }
  await applyBetaChannel();
  // Turning it ON should act now, not in three launches' time. The native check
  // runs before any of this app's JavaScript, so the check for THIS launch has
  // already gone out without the channel; and directUpdate is false, so anything
  // downloaded waits for the next background. Left alone that is toggle ->
  // launch -> background -> launch before anything happens, which reads exactly
  // like the switch not working.
  if (on) return await fetchAndApplyNow();
  // Turning it OFF has to undo what being on did. Clearing the id only changes
  // what future checks are offered — the beta bundle already downloaded keeps
  // running, so "leave the beta" would leave the player on beta code
  // indefinitely, until some public bundle happened to be newer. Unless the
  // bundle they are on has since been released, in which case there is nothing
  // to undo; leaveBeta() decides which case this is.
  await leaveBeta();
  return false;
}

/**
 * Check, download and switch to the newest bundle immediately.
 *
 * The same steps the plugin takes on its own, just not deferred: ask, fetch,
 * make it next, reload. `notifyAppReady` still guards the result — a bundle that
 * fails to boot reverts itself within `appReadyTimeout`, exactly as it would
 * have on the slow path.
 *
 * Every failure is swallowed and left to the automatic flow. This is an
 * accelerator, not the mechanism; if it cannot run, the update still arrives on
 * the next launch.
 *
 * @returns whether a bundle was applied
 */
export async function fetchAndApplyNow(): Promise<boolean> {
  if (!updaterReady()) return false;
  try {
    const { api: CapacitorUpdater } = await updater();
    const latest = await CapacitorUpdater.getLatest();
    const manifest = (latest as { manifest?: unknown[] })?.manifest;
    if (!latest?.version || (!latest.url && !manifest?.length)) return false;

    const current = await CapacitorUpdater.current().catch(() => null);
    if (current?.bundle?.version === latest.version) return false;

    track('ota_manual_check', { ota_bundle: latest.version });
    const bundle = await CapacitorUpdater.download({
      url: latest.url as string,
      version: latest.version,
      ...(latest.checksum ? { checksum: latest.checksum } : {}),
      ...(manifest?.length ? { manifest } : {}),
    } as Parameters<typeof CapacitorUpdater.download>[0]);
    if (!bundle?.id) return false;
    await CapacitorUpdater.set({ id: bundle.id });
    // reload() swaps the running bundle. It does not return in the usual sense —
    // the WebView is replaced — so nothing may be awaited after it.
    await CapacitorUpdater.reload();
    return true;
  } catch (err) {
    console.warn('[live-updates] immediate update failed, leaving it to autoUpdate', err);
    return false;
  }
}

/**
 * Which channel is the bundle on: "public", "beta", or null for "cannot tell"?
 *
 * The rule is AHEAD OF the public release, not EQUAL TO it. Equality was
 * match-merge's first version and it was wrong in the most visible way possible:
 * a player on 1.0.14 while 1.0.15 was public got a bright amber "Beta", because
 * the only question being asked was "is this exactly the current release".
 * Running an older public build is not being on a beta. You can only be on a
 * beta by running something newer than what everyone else has.
 *
 *  - `builtin` came from the store, so it is public whatever else is true.
 *  - No index means we do not know. Null, never a guess — this answer is shown
 *    to the player as a fact and used to decide whether to roll a save back.
 *  - Nothing released at all means any OTA bundle is pre-release.
 *
 * Pure, and exported, so the rule can be checked without a handset.
 */
export function channelOf(
  bundle: { id?: string; version?: string } | null | undefined,
  index: { public?: string | null } | null | undefined,
): 'public' | 'beta' | null {
  if (!bundle) return null;
  if (bundle.id === 'builtin') return 'public';
  if (!index) return null;
  if (!index.public) return 'beta';
  return isNewer(String(bundle.version ?? ''), String(index.public)) ? 'beta' : 'public';
}

/**
 * The published index, or null if it cannot be read.
 *
 * Fetched rather than remembered from boot: a bundle can be promoted from beta
 * to public while the app is open, and the whole point of the sync rule is that
 * it follows a promotion without needing a relaunch.
 */
async function fetchIndex(): Promise<OtaIndex | null> {
  try {
    // ABSOLUTE on native. Capacitor serves the app from https://localhost/, so a
    // relative "/ota/index.json" asks the running bundle for its own copy — and
    // `ota/` is excluded from the zip, so it is a 404 on every device, every
    // launch. In match-merge nothing reported it: every caller treats a null
    // index as "cannot tell" and carries on, so the index silently never loaded
    // and took the checkpoint, the store-update prompt and the channel label
    // down with it. The one visible symptom was the version line reading "Beta"
    // on a device that had never opted into anything.
    //
    // On the web build the relative path is right: that deployment serves its
    // own index, and pinning the origin would make a preview read production's.
    const url = Capacitor.isNativePlatform() ? `${OTA_ORIGIN}/ota/index.json` : '/ota/index.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as OtaIndex;
  } catch {
    return null;
  }
}

/**
 * Which bundle the plugin is actually serving, and whether it is the released
 * one.
 *
 * Distinct from the Beta updates switch, which records what the player asked
 * for. The two legitimately disagree — you turn beta on and stay on the public
 * bundle until the download lands, and you turn it off and stay on the beta
 * bundle until something replaces it.
 *
 * `OTA_VERSION` in `src/version.ts` is compiled into the bundle, so it says what
 * this code believes it is. This says what the updater believes it handed to the
 * WebView. They should agree; when they do not, the app has staged a bundle and
 * is running something else, and the settings-panel stamp says so out loud
 * rather than leaving a wrong number on screen.
 *
 * `isPublic` is null when the index could not be read: unknown, which is neither
 * Public nor Beta and must not be shown as either.
 */
export async function currentBundle(): Promise<{
  version: string;
  isPublic: boolean | null;
} | null> {
  if (!updaterReady()) return null;
  try {
    const { api: CapacitorUpdater } = await updater();
    const current = await CapacitorUpdater.current().catch(() => null);
    const bundle = current?.bundle;
    if (!bundle) return null;
    const version = String(bundle.version || current?.native || '');
    if (!version) return null;
    if (bundle.id === 'builtin') return { version, isPublic: true };
    const channel = channelOf(bundle, await fetchIndex());
    return { version, isPublic: channel === null ? null : channel === 'public' };
  } catch (err) {
    console.warn('[live-updates] current() failed', err);
    return null;
  }
}

/**
 * Is there a newer bundle this APK is too old to run?
 *
 * The endpoint refuses to serve such a bundle — that is what stops it being
 * applied, since the plugin checks natively before any of this code runs. But a
 * refusal is indistinguishable from "nothing new" from the device's side, so
 * without this the player simply stops receiving updates and is never told why.
 * This reads the same `min_native` out of the published index and reports it, so
 * the app can say "update from the store" instead of going quiet.
 *
 * Null when there is nothing to say: not native, no newer bundle, or a bundle
 * this APK can run perfectly well.
 */
export async function storeUpdateRequired(): Promise<{
  version: string;
  minNative: string;
  native: string;
} | null> {
  if (!updaterReady()) return null;
  try {
    const { api: CapacitorUpdater } = await updater();
    const current = await CapacitorUpdater.current().catch(() => null);
    const native = current?.native;
    if (!native) return null;

    const index = await fetchIndex();
    if (!index) return null;
    // The same audience rule the endpoint applies, or an opted-in player would
    // be told to update the store build for a bundle they were never offered.
    const wanted = betaEnabled() ? (index.beta ?? index.public) : index.public;
    if (!wanted) return null;
    const bundle = (index.bundles || []).find((b) => b?.version === wanted);
    if (!bundle) return null;

    // Only worth a word if the bundle is actually ahead of what is running.
    // Being held back from a version you already have is not news.
    const running = current?.bundle?.version || native;
    if (!isNewer(bundle.version, running)) return null;
    if (bundleRunsOn(bundle, native)) return null;

    return {
      version: String(bundle.version),
      minNative: String(bundle.min_native),
      native: String(native),
    };
  } catch {
    return null;
  }
}

/**
 * Leave the beta channel.
 *
 * Two different situations wear the same switch:
 *
 *  - **Already in sync.** The bundle being run IS the public release, so it is
 *    what this player would get as a non-beta player anyway. Leaving is then a
 *    pure bookkeeping change: no save restore, no reset, no reload, and no
 *    re-download of code the device already has. This is the common case once a
 *    beta has been promoted, and it must be non-destructive — a player who
 *    stayed on beta until it shipped has lost nothing and must not be rolled
 *    back for having helped test it.
 *
 *  - **Running an unreleased bundle.** Leaving is a code DOWNGRADE, so the save
 *    goes back to the last copy taken while a public bundle was running — the
 *    only version of it the public code is guaranteed to read.
 *
 * `reset()` reloads the app, so its promise may never resolve — nothing
 * meaningful may be awaited after it.
 */
async function leaveBeta(): Promise<void> {
  if (!updaterReady()) return;
  try {
    const { api: CapacitorUpdater } = await updater();
    const current = await CapacitorUpdater.current().catch(() => null);
    const bundle = current?.bundle;

    const channel = channelOf(bundle, await fetchIndex());
    if (channel !== 'beta') {
      // Either this bundle is a public build — nothing to undo, and reset()
      // would reload and throw away a bundle it would download again — or the
      // index could not be read, in which case we do not know. Rolling a save
      // back on a failed network call is not caution, it is data loss on a blip;
      // the switch is off either way and the next launch will sort the bundle
      // out.
      track('ota_beta_opt_out', {
        ota_bundle: bundle?.version ?? null,
        save_restored: false,
        in_sync: channel === 'public',
        channel_known: channel !== null,
      });
      return;
    }

    const restored = restoreCheckpoint(localStorage);
    track('ota_beta_opt_out', {
      ota_bundle: bundle?.version ?? null,
      save_restored: restored,
      in_sync: false,
    });
    await CapacitorUpdater.reset();
  } catch (err) {
    console.warn('[live-updates] could not leave the beta channel', err);
  }
}

/**
 * True when leaving the beta would roll the save back to an older state.
 *
 * Asked before the confirm prompt, so the two cases that cost nothing are never
 * dressed up as a loss: a player already on the public bundle (leaving is a
 * no-op), and a player who took a beta bundle and played nothing.
 */
export async function betaRevertWouldLoseProgress(): Promise<boolean> {
  try {
    if (!updaterReady()) return false;
    const { api: CapacitorUpdater } = await updater();
    const current = await CapacitorUpdater.current().catch(() => null);
    const bundle = current?.bundle;
    if (bundle?.id === 'builtin') return false;
    if (channelOf(bundle, await fetchIndex()) === 'public') return false;
    return saveDivergedFromCheckpoint(localStorage);
  } catch {
    return false;
  }
}

/**
 * Take a known-good copy of the save, but only while the PUBLIC bundle is the
 * one running.
 *
 * That is the whole trick: a checkpoint written mid-beta would be in whatever
 * shape the beta uses, which is exactly what the public bundle cannot read.
 * Taken here, it is by construction a save the public code wrote and can read
 * back.
 *
 * The packaged bundle counts — it came from the store, so it is public by
 * definition. An OTA bundle counts only if the index currently marks it public.
 */
export async function checkpointIfPublic(): Promise<void> {
  if (!updaterReady()) return;
  try {
    const { api: CapacitorUpdater } = await updater();
    const current = await CapacitorUpdater.current().catch(() => null);
    const bundle = current?.bundle;
    if (!bundle) return;

    if (bundle.id === 'builtin') {
      writeCheckpoint(localStorage, `native:${current?.native ?? ''}`, Date.now());
      return;
    }

    // Ask the server whether the bundle being run is the released one. Cheap,
    // cached by the CDN, and it means the answer follows a promotion without the
    // app needing a new build — the launch after a beta is promoted takes a
    // fresh checkpoint of the save as it stands, so a player who tested a bundle
    // all the way to release keeps everything they did on it.
    if (channelOf(bundle, await fetchIndex()) === 'public') {
      writeCheckpoint(localStorage, bundle.version, Date.now());
    }
  } catch {
    // A checkpoint is a safety net. Failing to take one must never be louder
    // than the game itself.
  }
}

/**
 * Push the current choice to the plugin. Called on the toggle and once at boot,
 * because a player who opted in on a previous install (or before an update wiped
 * the plugin's copy) must not silently fall back to stable.
 */
export async function applyBetaChannel(): Promise<void> {
  if (!updaterReady()) return;
  try {
    const { api: CapacitorUpdater } = await updater();
    await CapacitorUpdater.setCustomId({ customId: betaEnabled() ? 'beta' : '' });
  } catch (err) {
    // Never let update plumbing break the game: the worst case is the player
    // staying on stable bundles, which is the safe side of this switch.
    console.warn('[live-updates] could not set the update channel', err);
  }
}

// ===== Check on every return to the app =====

/**
 * True while a check is in flight, so two foregrounds in quick succession do not
 * start two downloads of the same bundle.
 */
let checking = false;

/**
 * Check for an update every time the app comes back to the foreground, and apply
 * it there and then.
 *
 * The plugin does check on foreground by itself, but with `directUpdate: false`
 * it only downloads — the swap waits for the NEXT trip to the background, and
 * the one after that to be running. From the player's side that is
 * indistinguishable from nothing happening: background, reopen, no change.
 *
 * So the check is driven here instead: fetch and apply immediately, with the
 * loading screen over it, so returning to the app either changes nothing or
 * visibly updates. `notifyAppReady` still guards the result — a bundle that
 * fails to boot reverts itself.
 *
 * `onStart` raises the loading screen, `onIdle` lowers it again when there was
 * nothing to do. `onStoreUpdate` fires instead of `onIdle` when an update exists
 * but this APK is too old for it — the difference matters, because that case is
 * otherwise silent and permanent. Nothing runs after an update is applied: the
 * WebView is being replaced.
 */
export function checkOnResume({
  onStart,
  onIdle,
  onStoreUpdate,
}: {
  onStart: () => void;
  onIdle: () => void;
  onStoreUpdate?: (info: { version: string; minNative: string; native: string }) => void;
}): void {
  if (!updaterReady()) return;

  const run = async (): Promise<void> => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      onStart();
      const applied = await fetchAndApplyNow();
      if (applied) return;
      // Nothing was applied. Distinguish "there is nothing new" from "there is
      // something new and your APK cannot run it" — only the second is worth
      // interrupting anyone about, and only it stays true until they act.
      const blocked = onStoreUpdate ? await storeUpdateRequired() : null;
      if (blocked) {
        track('ota_store_update_required', {
          ota_bundle: blocked.version,
          min_native: blocked.minNative,
          native: blocked.native,
        });
        onStoreUpdate?.(blocked);
        return;
      }
      onIdle();
    } catch {
      onIdle();
    } finally {
      checking = false;
    }
  };

  // `visibilitychange` rather than `focus`: the WebView reports the former
  // reliably when the app is task-switched, which is the case that matters.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void run();
  });

  // And once now. A cold start never fires a visibilitychange — the page is
  // already visible by the time anything listens — so without this the launch
  // straight after installing checked for nothing, and only the SECOND
  // foreground picked an update up.
  //
  // The caller must have finished notifyBootOk before calling this: the check
  // can end in reload(), and swapping the bundle out from under a notifyAppReady
  // that has not landed yet would let the rollback timer condemn a bundle that
  // was fine.
  void run();
}
