# Unbound Descent — Google Play Console kit

Canonical answers for the Console session ([issue #1](https://github.com/ai-asylum/stepper-mage/issues/1)).
Everything here is checked against the code as shipped, not against the design docs.

| | |
|---|---|
| Package id | `games.misaligned.unbounddescent` (permanent) |
| Signed AAB | [run 31649598737](https://github.com/ai-asylum/stepper-mage/actions/runs/31649598737) |
| Privacy policy | https://stepper-mage.vercel.app/store/privacy.html |
| Data deletion | https://stepper-mage.vercel.app/store/data-deletion.html |
| Terms | https://stepper-mage.vercel.app/store/terms.html |

## ⚠️ Fix before the first upload

1. **Golems are not in the shipping build.** `BELT_ENABLED` is `false`
   ([src/flags.ts](../src/flags.ts)), and object animation is a belt ingredient —
   the flag's own note says golems are unreachable while it is off, and that
   everything advertising an animation was removed "because that advertisement
   would now be a lie". **The listing copy below therefore does not mention
   golems, animating furniture, or the ingredient belt**, even though the README
   still leads with them. If the belt is switched on before submission, the copy
   should be rewritten to sell it — it is the strongest hook the game has.
2. **Contact email is inconsistent across the org.** The launch checklist uses
   `support@misaligned.games` (and the live privacy/terms/deletion pages now say
   that); total-clash's listing kit uses `hello@misaligned.games`. Pick one. If
   it is `hello@`, update [store/fakedoor.config.json](fakedoor.config.json) and
   regenerate the three legal pages.
3. ~~No screenshots and no feature graphic yet.~~ **Done** — 5 screenshots and a
   feature graphic are in [store/](.); see Graphics assets below.

---

## Main store listing

**App name** (≤30):
```
Unbound Descent
```

**Short description** (≤80):
```
Tear pages from your spellbook and fuse them. A first-person dungeon stepper.
```

**Full description** (≤4000):
```
Unbound Descent is a first-person dungeon crawler with no weapons and no armour. You carry a grimoire, and that is all.

Leaf through the book with your thumb, tear pages out, and fuse what you are holding into a single cast. A page supplies an element. The room supplies the rest — draw fire straight off a lit candelabra, or rot out of a corpse — so the dungeon itself is your component pouch.

There is no mana. A cast costs you a turn, and every turn you take hands the room a free action back. Nothing else costs anything, which makes the only question that matters this one: what are you holding when it is your move?

You begin able to hold one thing at a time. That is the whole game's gate — a hand of one is where fusion gets sold to you rather than explained. Find a second page and you can combine them. Find a third and the spell list opens up.

FEATURES
• Tear and fuse — combine pages into a single cast and discover what they make
• Six elements — fire, frost, spark, gust, plant and rot, each leaving its own status behind
• Harvest the room — take an element straight off a fixture, adjacent and facing
• Reactions that spread — burning ground, oil, frozen tiles, and rot that eats what it touches
• A turn-based descent — floors that only go down, with a boss on each
• Free the caged — cut wizards out of locked cells and add them to your roster
• Levers, plates and gates — mechanisms you can see work, and a camera that shows you
• A star tree — bank what you earn into permanent unlocks that change behaviour, not numbers
• Free to play. No ads, no in-app purchases.

Tear the page. Take the turn. Go down.
```

**What's new / release notes** (≤500):
```
The first release of Unbound Descent. Tear pages out of your grimoire, fuse them, and cast your way down. Tell us what you want next: support@misaligned.games
```

## Categorization & contact

| Field | Value |
|---|---|
| App or game | **Game** |
| Category | **Role Playing** (alt: Adventure) |
| Tags (≤5) | Dungeon crawler · Turn-based · Roguelike · Pixel art · Single player |
| Email | `support@misaligned.games` *(confirm — see Fix #2)* |
| Website | `https://stepper-mage.vercel.app` |
| Privacy policy URL | `https://stepper-mage.vercel.app/store/privacy.html` |

## Graphics assets — status & spec

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512, 32-bit PNG, ≤1 MB | ✅ [public/icons/icon-512.png](../public/icons/icon-512.png) |
| Logo / splash | square | ✅ [store/logo.png](logo.png), formatted to `assets/splash.png` by `tools/genlogo.mjs` |
| Feature graphic | 1024×500 PNG/JPEG | ✅ [store/feature-graphic.png](feature-graphic.png) — generated, centre band of `art/_work/raw/feature-a.png` |
| Phone screenshots (2–8) | PNG/JPEG, 320–3840px/side, ratio no wider than 2:1 | ✅ 5 × 1152×2048 PNG (9:16), dressed with slogans via Scenario, in [store/shots/](shots/); undressed captures kept in [store/shots/raw/](shots/raw/) |

Play rejects WebP; these are PNG.

The five, in upload order — each one carries a different line from the
description, which is why there are five and not two:

| # | Shot | Sells |
|---|---|---|
| 01 | `01-descent.png` | first-person grid dungeon, a creature down the room |
| 02 | `02-grimoire.png` | **the hero shot** — Flame + Frost torn out, fusing into STEAM BURST |
| 03 | `03-altar.png` | the altar's three-way upgrade choice |
| 04 | `04-startree.png` | the star tree, i.e. the reason to start another run |
| 05 | `05-deep.png` | depth VI, a different palette and a lit enemy |

Regenerate with `node tools/storeshots.mjs`. It is deterministic — the dungeon
seed is pinned to `store-shots-2`, so a retake frames the same rooms. Three
things it handles that a naive capture gets wrong, all of which produced a
discarded set first: it shoots the `#stage` element (the viewport has letterbox
bars), it clears `hud.hasMoved` before every frame (`enterFloor` rebuilds the
HUD, so SWIPE TO MOVE comes back on each new floor), and it frames the deep shot
on a creature at ≥4 tiles using the grid's own raycast (`bestViews()` optimises
for sightline length, which reliably finds the emptiest room on the floor).

---

## IARC content-rating questionnaire

Category **Game**. Answer as below; Play auto-computes the rating (don't set it manually):

- Violence: **Yes → cartoon/fantasy** (spells kill pixel-art creatures; no gore)
- Realistic violence / toward real-looking humans or animals: **No**
- Blood or gore: **No**
- Sexual content or nudity: **No**
- Fear / horror: **No** (dark dungeon setting, no horror content)
- Simulated or real gambling: **No**
- Profanity / crude humor: **No**
- Drugs, alcohol, tobacco: **No**
- User interaction (chat), shares location, user-generated content: **No**
- Digital purchases (IAP): **No** — no Play Billing SDK is linked

Expected result: ~PEGI 7 / ESRB Everyone 10+.

## Data safety

> **This differs from total-clash's kit — do not copy that one.** This app ships
> AppsFlyer, so device IDs are **shared** with a third party. total-clash's kit
> answers "shared: No", which is wrong here. Conversely, PostHog **session
> replay does not run** in this app: `enableSessionReplay()` exists in
> [src/systems/analytics.ts](../src/systems/analytics.ts) but is never called,
> so there are no recordings to disclose.

- Does your app collect or share user data? → **Yes**
- **App activity** — in-app product events (`session_start`, `floor_entered`,
  `run_ended`). Collected, not shared. Purpose: **Analytics**.
- **Device or other IDs** — two of them, and they answer differently:
  - PostHog anonymous `distinct_id` → collected, **not** shared. Purpose: Analytics.
  - Advertising ID (GAID) via AppsFlyer → collected **and shared**. Purpose:
    **Advertising or marketing** (install attribution). The app declares
    `com.google.android.gms.permission.AD_ID`.
- **Approximate location** — **Yes**, country-level, derived from IP by PostHog's
  geoIP. Collected, not shared. Purpose: Analytics.
- Encrypted in transit: **Yes**
- Users can request deletion: **Yes** — https://stepper-mage.vercel.app/store/data-deletion.html
- Collection optional/required: **Required** (no opt-out toggle ships today —
  mark optional only if one is added)

> Surface is kept lean: `person_profiles: 'identified_only'`, autocapture off,
> `disable_session_recording: true`, localStorage persistence. geoIP stays on for
> the country breakdown, hence "Approximate location".

## App content declarations

| Declaration | Answer |
|---|---|
| Ads | **No, does not contain ads** — no ad SDK is linked. AppsFlyer is attribution, not ad serving |
| Target age | **13+** (13–15, 16–17, 18+) — not designed for children |
| Appeals to children | No |
| App access | All functionality available without special access (no login, no accounts) |
| News app | No |
| COVID-19 tracing/status | No |
| Government app | No |
| Financial features | No |
| Health | No |
| Data deletion | https://stepper-mage.vercel.app/store/data-deletion.html |

---

## CI → Play delivery

Wired in [android-build.yml](../.github/workflows/android-build.yml).

- Triggers on push to `main` and on manual dispatch. **Not on pull requests** —
  a PR branch needs a `workflow_dispatch` to build.
- `versionCode` is `git rev-list --count HEAD`: monotonic, no gaps from failed runs.
- Signing uses the org-wide upload keystore (`ANDROID_KEYSTORE_BASE64` /
  `ANDROID_KEYSTORE_PASSWORD`). Verified working — the AAB carries
  `META-INF/UPLOAD.RSA`.
- Uploads to the **internal** track with `status: completed` via
  `PLAY_SERVICE_ACCOUNT_JSON`.
- **The upload step fails until the app exists in Play Console** —
  `Package not found: games.misaligned.unbounddescent`. Expected: Google requires
  the first upload of a new app to be manual. Re-run after the manual upload and
  it goes green.

## PostHog config (as shipped)

[src/systems/analytics.ts](../src/systems/analytics.ts), project `247326` (EU cloud).

- Key inlined at build time from the repo secret `VITE_POSTHOG_KEY`; host
  `VITE_POSTHOG_HOST` = `https://eu.i.posthog.com`.
- **No key ⇒ every call is a no-op.** The Vercel web deploy does not inject the
  key, so the browser build collects nothing — only the Android CI build does.
- Events: `session_start` (boot), `floor_entered` (`{depth}`), `run_ended`
  (`{kind, depth, earned, best}`).
