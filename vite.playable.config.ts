import { playableConfig } from 'playable-kit/vite';

/**
 * The kit's factory owns the parts that must not drift per game: single-file
 * inlining, `base: './'`, and above all `build.target: 'es2020'` — ad WebViews
 * are an old fleet, es2021+ syntax parse-errors there, and the whole creative
 * dies before line one while impressions keep billing.
 */
export default {
  ...playableConfig({
    entry: 'playable.html',
    define: { __PLAYABLE__: 'true' },
  }),
  // This repo has a .env.local holding a VERCEL_OIDC_TOKEN. Nothing there is
  // VITE_-prefixed so Vite would not inline it today, but a creative that ships
  // to third-party ad networks is the last file that should be reading env at
  // all — so don't.
  envFile: false,
};
