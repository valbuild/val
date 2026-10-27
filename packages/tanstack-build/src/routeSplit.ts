// autoCodeSplitting.
//
// Start splits a route file in two: the *reference* keeps the loader and the
// route's critical options and replaces the component with
// `lazyRouteComponent(() => import('...?tsr-split=component'))`, and the
// *virtual* module holds the component itself. The builder already handles the
// resulting dynamic import; what it cannot do is produce the split.
//
// That split is `@tanstack/router-plugin`'s, built on @babel/core, and it does
// not run in a browser. Bundled for the browser target it comes to 1.14 MB and
// evaluates as far as `require('@babel/traverse')` -- Babel requires its own
// packages by name at module scope, which is the reason @babel/standalone
// exists at all. Verified, not assumed: the probe got as far as a real Chromium.
//
// So this is a capability the caller supplies, like Tailwind's module loader.
// `packages/publish` has Node and passes one. A browser build does not split,
// and unlike a missing Tailwind plugin that costs *bytes rather than
// correctness* -- an unsplit route component renders exactly the same, it just
// ships in the entry. That is why this is allowed to differ by environment
// where `@plugin` is not.
export interface RouteSplitter {
  /**
   * Rewrites a route file to defer its split options.
   *
   * Returns null when the file has nothing to split, which is most of them.
   */
  reference(id: string, code: string): { code: string } | null;
  /** Produces the deferred half, containing only `targets`. */
  virtual(id: string, code: string, targets: Array<string>): { code: string };
}

/** Query Start's splitter emits, e.g. `?tsr-split=component---errorComponent`. */
export const SPLIT_QUERY = "tsr-split";

/** Is this a route file, i.e. one the splitter should look at? */
export const isRouteFile = (path: string, routesDir = "src/routes/") =>
  path.startsWith(routesDir) && /\.(tsx?|jsx?)$/.test(path);

export interface SplitRequest {
  path: string;
  targets: Array<string>;
}

/**
 * Reads `./posts.tsx?tsr-split=component---errorComponent`.
 *
 * Returns null for anything else, including a `?raw` or `?url` query, so the
 * caller can fall through to its other handling.
 */
export function parseSplitRequest(source: string): SplitRequest | null {
  const [path, query] = source.split("?");
  if (!path || !query) return null;
  const match = new RegExp(`(?:^|&)${SPLIT_QUERY}=([^&]*)`).exec(query);
  if (!match) return null;
  return { path, targets: match[1]!.split("---").filter(Boolean) };
}
