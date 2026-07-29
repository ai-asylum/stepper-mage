/**
 * playable-kit ships as plain ESM with no bundled types. Only the runtime shim
 * is imported by game code (`src/dungeon/sprites.ts`), so that is all this
 * declares — see the kit's `runtime.js` for the behaviour.
 */
declare module 'playable-kit/runtime' {
  /** The embedded asset map, or null outside a playable bundle. */
  export function playableAssets(): Record<string, string> | null;
  /** True when running inside a playable-ad bundle. */
  export function isPlayableBundle(): boolean;
  /** Resolve an asset path against the embedded map; identity outside a playable. */
  export function assetUrl(requested: string): string;
  export function urlModifier(): (requested: string) => string;
  export function withPlayableAssets<T extends { setURLModifier(fn: (u: string) => string): void }>(
    manager: T,
  ): T;
}
