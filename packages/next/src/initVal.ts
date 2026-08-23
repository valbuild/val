import {
  initVal as createValSystem,
  type ValConfig,
  type ContentConstructor,
  type InitVal,
  type ReplaceRawStringWithString,
  type Schema,
  type SelectorOfSchema,
  type SelectorSource,
  type ValConstructor,
  type ValModule,
  Internal,
  ValRouter,
} from "@valbuild/core";
import type { ReactNode } from "react";
import type { inferSchema } from "./ValTypes";
import { raw } from "@valbuild/react/stega";
import { getUnpatchedUnencodedVal } from "./getUnpatchedUnencodedVal";
import { decodeValPathsOfString } from "./decodeValPathsOfString";
import { attrs } from "@valbuild/react/stega";

/**
 * `c` with a React-aware `c.component`.
 *
 * Core declares `c.component` without knowing what a React component is, so
 * the props it accepts are unchecked there. Narrowing it here ties the props of
 * the component to the schema of the module - i.e. exactly the type the app
 * gets back from `fetchVal` / `useVal` for that module.
 */
type NextContentConstructor = Omit<ContentConstructor, "component"> & {
  /**
   * EXPERIMENTAL: like `c.define`, but the module also carries the component
   * that renders it, so the Val UI can preview the component while an editor
   * edits its content.
   *
   * The last argument is default content: a fixture the preview falls back to
   * when the section is not used anywhere yet, and a good place for
   * deliberately unrepresentative values (very long names, empty lists) that
   * make layout problems easy to spot. It is an extra - the preview shows the
   * component with the content of every real usage too.
   *
   * It is optional. Omitted, the emptiest value the schema accepts is used.
   *
   * @example
   * // app/sections/hero.val.tsx
   * export const schema = s.object({ title: s.string() });
   *
   * function Hero({ title }: t.inferSchema<typeof schema>) {
   *   return <h1>{title}</h1>;
   * }
   *
   * export default c.component("/app/sections/hero.val.tsx", Hero, schema, {
   *   title: "Example title",
   * });
   */
  component: <T extends Schema<SelectorSource>>(
    id: string,
    component: (props: inferSchema<T>) => ReactNode,
    schema: T,
    source?: ReplaceRawStringWithString<SelectorOfSchema<T>>,
  ) => ValModule<SelectorOfSchema<T>>;
};

const nextAppRouter: ValRouter = Internal.nextAppRouter;
const externalPageRouter: ValRouter = Internal.externalPageRouter;

/**
 * Returns true if the Val Enable cookie is set. Must be called in a
 * Server Component, Server Action, or Route Handler — it reads from
 * `next/headers` and returns false in any other context.
 *
 * ⚠️ Reading cookies opts the route into **dynamic rendering**: calling this
 * in a layout or page disables static generation and the full route cache for
 * every route it covers, for all visitors. It is NOT needed for the
 * `suspend` prop on ValProvider (which detects the cookie client-side) —
 * reserve it for advanced server-side conditionals.
 */
async function isValEnabled(): Promise<boolean> {
  try {
    // Dynamic import so the top-level `@valbuild/next` entry doesn't pull
    // `next/headers` into client bundles or the pages/ directory (both of
    // which break Next's build). Resolved only when this fn is actually
    // called, which must be from an RSC / Server Action / Route Handler.
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    return cookieStore.get(Internal.VAL_ENABLE_COOKIE_NAME)?.value === "true";
  } catch {
    return false;
  }
}

export const initVal = (
  config?: ValConfig,
): Omit<InitVal, "c"> & {
  c: NextContentConstructor;
  /**
   * Returns true if the Val Enable cookie is set. Must be called in a
   * Server Component, Server Action, or Route Handler — it reads from
   * `next/headers` and returns false in any other context.
   *
   * ⚠️ Reading cookies opts the route into **dynamic rendering**: calling
   * this in a layout or page disables static generation and the full route
   * cache for every route it covers, for all visitors. It is NOT needed for
   * the `suspend` prop on ValProvider (which detects the cookie client-side)
   * — reserve it for advanced server-side conditionals.
   */
  isValEnabled: typeof isValEnabled;
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
    nextAppRouter,
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
