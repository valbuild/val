import type { ReactElement } from "react";
import type { SelectorSource, ValModule, ValModules } from "@valbuild/core";
import {
  findValModule,
  resolveValComponentPreview,
  ValPreviewMessage,
} from "@valbuild/react/internal";

export type ValComponentPreviewOptions = {
  /** The app's `val.modules` registry (the default export of val.modules.ts). */
  valModules: ValModules;
  /**
   * Source path of the value to render, e.g.
   * `/content/pages.val.ts?p="landing"."sections".0`.
   *
   * The schema at this path says which component renders it: an object with
   * `.render({ as: "component", component })`, or a discriminated union whose
   * variant at this path is one.
   */
  sourcePath: string;
  /**
   * Render the `example` of the render instead of the content at `sourcePath`.
   */
  example?: boolean;
  /**
   * Props to render with, overriding both the content and the example. For
   * trying out values without changing any content.
   *
   * Converted the way content is (an image source gains its `url`), so they
   * are written as SOURCE, the same shape as in a `.val.ts`.
   */
  props?: unknown;
  /**
   * The app's own `fetchVal` (from `initValRsc`).
   *
   * Passed in rather than created here because it is bound to the app's config
   * and to the Next.js `headers` / `cookies` / `draftMode` of the app.
   */
  fetchVal: (module: ValModule<SelectorSource>) => Promise<unknown>;
};

/**
 * EXPERIMENTAL: renders the value at a source path with the component its
 * schema declares - `s.object(...).render({ as: "component", component })`.
 *
 * Meant to be called from a Server Component behind a route that the Val UI
 * loads in an iframe, so an editor sees the section they are editing, rendered
 * by the app itself: its own React, CSS, fonts and providers.
 *
 * This is a plain async function rather than a component because React 18
 * types do not allow async components in JSX. Call it and return the result:
 *
 * @example
 * // app/val-preview/page.tsx
 * export default async function ValPreviewPage({ searchParams }) {
 *   const { p, example } = await searchParams;
 *   return unstable_renderValComponent({
 *     valModules,
 *     sourcePath: p,
 *     example: example === "1",
 *     fetchVal,
 *   });
 * }
 */
export async function unstable_renderValComponent({
  valModules,
  sourcePath,
  example,
  props,
  fetchVal,
}: ValComponentPreviewOptions): Promise<ReactElement> {
  const valModule = await findValModule(valModules, sourcePath);
  if (!valModule) {
    return (
      <ValPreviewMessage>
        {`No module for '${sourcePath}' in val.modules.`}
      </ValPreviewMessage>
    );
  }
  const resolution = await resolveValComponentPreview({
    valModule,
    sourcePath,
    moduleValue: await fetchVal(valModule),
    example,
    props,
  });
  if (resolution.status === "error") {
    return <ValPreviewMessage>{resolution.message}</ValPreviewMessage>;
  }
  const { Component } = resolution;
  return <Component {...resolution.props} />;
}
