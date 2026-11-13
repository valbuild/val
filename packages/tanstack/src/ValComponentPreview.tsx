import type { ValModules } from "@valbuild/core";
import {
  findValModule,
  resolveValComponentPreview,
  ValPreviewMessage,
  type ValComponentPreviewResolution,
} from "@valbuild/react/internal";
import { useEffect, useState } from "react";
import type { ValPreviewSource } from "./server/fetchValPreviewSource";

/**
 * EXPERIMENTAL: renders the value at a source path with the component its
 * schema declares - `s.object(...).render({ as: "component", component })`.
 *
 * The TanStack half of a component preview. The content is read on the server
 * (`unstable_fetchValPreviewSource` from `@valbuild/tanstack/server`, through
 * a server function in the route's loader), and the component is found and
 * rendered here, in the browser: its `import()` is the app's own, so it is
 * the app's code that renders it, with the app's CSS.
 *
 * `source` is what the loader returned; the rest says what to render.
 *
 * `Unstable_` rather than `unstable_` like `@valbuild/next`'s
 * `unstable_renderValComponent`: this one is a component, and JSX reads a tag
 * that starts with a lower-case letter as an HTML element.
 */
export function Unstable_ValComponentPreview({
  valModules,
  source,
  example,
  props,
}: {
  /** The app's `val.modules` registry (the default export of val.modules.ts). */
  valModules: ValModules;
  /** What `unstable_fetchValPreviewSource` returned for the source path. */
  source: ValPreviewSource;
  /** Render the render's `example` instead of the content. */
  example?: boolean;
  /** Props to render with instead, written as source. */
  props?: unknown;
}) {
  const [resolution, setResolution] =
    useState<ValComponentPreviewResolution | null>(null);
  useEffect(() => {
    if (source.status === "error") {
      return;
    }
    let cancelled = false;
    (async () => {
      const valModule = await findValModule(valModules, source.sourcePath);
      const next: ValComponentPreviewResolution = valModule
        ? await resolveValComponentPreview({
            valModule,
            sourcePath: source.sourcePath,
            moduleValue: JSON.parse(source.moduleJson),
            example,
            props,
          })
        : {
            status: "error",
            message: `No module for '${source.sourcePath}' in val.modules.`,
          };
      if (!cancelled) {
        setResolution(next);
      }
    })().catch((err) => {
      if (!cancelled) {
        setResolution({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [valModules, source, example, props]);

  if (source.status === "error") {
    return <ValPreviewMessage>{source.message}</ValPreviewMessage>;
  }
  // Nothing until the first resolution, and the previous one while the next
  // is on its way, so a refresh does not flash an empty frame.
  if (resolution === null) {
    return null;
  }
  if (resolution.status === "error") {
    return <ValPreviewMessage>{resolution.message}</ValPreviewMessage>;
  }
  const { Component } = resolution;
  return <Component {...resolution.props} />;
}
