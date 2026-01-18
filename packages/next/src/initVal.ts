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

const nextAppRouter: ValRouter = Internal.nextAppRouter;
const externalUrlPage: ValRouter = Internal.externalUrlPage;

export const initVal = (
  config?: ValConfig,
): InitVal & {
  val: ValConstructor & {
    /**
     * Returns the original module data, without any applied patches or stega encoding.
     *
     * This represents the raw, canonical state of the module as it was initially defined.
     * NOTE: images and files, will be transformed (and will therefore) include the url property.
     *
     * ⚠️ Prefer using `fetchVal` (in React Server Components) or `useVal` (in React Client Components)
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
   * The Next.js App Router for use on s.record().router(...)
   *
   * @see https://val.build/docs/page-router
   *
   * @example
   * const pages = s.record(s.object({ title: s.string() })).router(nextAppRouter);
   * export default c.define("/pages/[slug].val.ts", pages, {
   *   "/about": { title: "About" },
   *   "/contact": { title: "Contact" },
   * });
   */
  nextAppRouter: ValRouter;
  externalUrlPage: ValRouter;
} => {
  const { s, c, val, config: systemConfig } = createValSystem(config);
  const currentConfig = {
    ...systemConfig,
    ...config,
  };
  return {
    s,
    c,
    nextAppRouter,
    externalUrlPage,
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
