import {
  initVal as createValSystem,
  type ValConfig,
  type InitVal,
  type ValConstructor,
  Internal,
  ValRouter,
} from "@valbuild/core";
import { raw } from "@valbuild/react/stega";
import { getUnpatchedUnencodedVal } from "./getUnpatchedUnencodedVal";
import { decodeValPathsOfString } from "./decodeValPathsOfString";
import { attrs } from "@valbuild/react/stega";

const tanstackRouter: ValRouter = Internal.tanstackRouter;
const externalPageRouter: ValRouter = Internal.externalPageRouter;

/**
 * Returns true if the Val Enable cookie is set. Must be called on the server —
 * inside a server function, a server route handler, or during SSR — and
 * returns false anywhere else.
 *
 * Not needed for the `suspend` prop on ValProvider, which detects the cookie
 * client-side; reserve it for advanced server-side conditionals.
 */
async function isValEnabled(): Promise<boolean> {
  try {
    // Dynamic import so the top-level `@valbuild/tanstack` entry does not pull
    // TanStack's server module into the client bundle. `@tanstack/react-start`
    // splits client and server, and the server half reads the request out of
    // async local storage — there is nothing to read in a browser.
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(Internal.VAL_ENABLE_COOKIE_NAME) === "true";
  } catch {
    return false;
  }
}

export const initVal = (
  config?: ValConfig,
): InitVal & {
  /**
   * Returns true if the Val Enable cookie is set. Must be called on the
   * server — inside a server function, a server route handler, or during SSR —
   * and returns false anywhere else.
   *
   * Not needed for the `suspend` prop on ValProvider, which detects the cookie
   * client-side; reserve it for advanced server-side conditionals.
   */
  isValEnabled: typeof isValEnabled;
  val: ValConstructor & {
    /**
     * Returns the original module data, without any applied patches or stega encoding.
     *
     * This represents the raw, canonical state of the module as it was initially defined.
     * NOTE: images and files, will be transformed (and will therefore) include the url property.
     *
     * ⚠️ Prefer using `fetchVal` (on the server) or `useVal` (in components)
     * for most application logic.
     *
     * This method is primarily intended for tooling and other advanced use cases
     * outside of the actual application.
     */
    unstable_getUnpatchedUnencodedVal: typeof getUnpatchedUnencodedVal;
    /**
     * Convert any object that is encoded with Val stega encoding back to the original values
     */
    raw: typeof raw;
    /**
     * Get the Val paths of attributes for any object.
     *
     * This is typically used to manually set the data-val-path attribute for visual editing on any element.
     *
     * @example
     * const page = useVal(pageVal)
     * <a href={page.url.href} {...val.attrs(page)}>
     *   {page.url.label}
     * </a>
     */
    attrs: typeof attrs;
    unstable_decodeValPathsOfString: typeof decodeValPathsOfString;
  };
  /**
   * The TanStack Router for use on s.record().router(...)
   *
   * The Val module of a route is named after the route file it sits beside:
   * `src/routes/posts.$postId.tsx` is served content by
   * `src/routes/posts.$postId.val.ts`. Directory notation
   * (`src/routes/posts/$postId.val.ts`) is the same route.
   *
   * @example
   * const pages = s.record(s.object({ title: s.string() })).router(tanstackRouter);
   * export default c.define("/src/routes/posts.$postId.val.ts", pages, {
   *   "/posts/hello-world": { title: "Hello world" },
   * });
   */
  tanstackRouter: ValRouter;
  externalPageRouter: ValRouter;
} => {
  const { s, c, val, config: systemConfig } = createValSystem(config);
  const currentConfig = {
    ...systemConfig,
    ...config,
  };
  return {
    s,
    c,
    isValEnabled,
    tanstackRouter,
    externalPageRouter,
    val: {
      ...val,
      attrs,
      unstable_decodeValPathsOfString: decodeValPathsOfString,
      raw,
      unstable_getUnpatchedUnencodedVal: getUnpatchedUnencodedVal,
    },
    config: currentConfig,
  };
};
