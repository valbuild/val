import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  getComponentRender,
  Internal,
  loadComponent,
  type SelectorSource,
  type Source,
  type SourcePath,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import { stegaEncode } from "@valbuild/react/stega";

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
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
  const valModule = await findModule(valModules, moduleFilePath);
  if (!valModule) {
    return (
      <PreviewMessage>
        {`No module '${moduleFilePath}' in val.modules.`}
      </PreviewMessage>
    );
  }
  const moduleSchema = Internal.getSchema(valModule);
  if (!moduleSchema) {
    return (
      <PreviewMessage>{`'${moduleFilePath}' has no schema.`}</PreviewMessage>
    );
  }

  // The schema is resolved through the CONTENT rather than the module's own
  // source: a section added in the Studio is in the former and not the latter,
  // and only the content says which variant of a union a section is.
  const moduleValue = await fetchVal(valModule);
  let schema = moduleSchema;
  let value: unknown = moduleValue;
  if (modulePath) {
    try {
      const resolved = Internal.resolvePath(
        modulePath,
        // `fetchVal` is typed per module by the app; what it returns is the
        // module's source with media resolved, which is what this walks.
        moduleValue as Source,
        moduleSchema,
      );
      schema = resolved.schema;
      value = resolved.source;
    } catch (err) {
      return (
        <PreviewMessage>
          {`${sourcePath}: ${err instanceof Error ? err.message : String(err)}`}
        </PreviewMessage>
      );
    }
  }

  const render = getComponentRender(schema, value);
  if (!render) {
    return (
      <PreviewMessage>
        {`${sourcePath} has no component: give its schema .render({ as: "component", component }) to preview it.`}
      </PreviewMessage>
    );
  }

  if (props !== undefined || example) {
    const source = props !== undefined ? props : render.example;
    if (source === undefined) {
      return <PreviewMessage>{`${sourcePath} has no example.`}</PreviewMessage>;
    }
    // Neither is content, so no edit tags: a click in the preview must not
    // lead to a field the value is not in.
    value = stegaEncode(source, {
      disabled: true,
      root: { path: sourcePath, schema: schema["executeSerialize"]() },
    });
  }

  if (!isRecord(value)) {
    return (
      <PreviewMessage>
        {`Expected an object to spread as props, got ${
          value === null ? "null" : typeof value
        }.`}
      </PreviewMessage>
    );
  }
  // Core cannot express a React component's type, and the lookup above is by
  // path, which erases the relation between the schema and its component that
  // `.render(...)` was given. This cast is what restores it - and the reason
  // this helper lives in the library instead of in every app with a preview.
  const Component = (await loadComponent(render)) as ComponentType<
    Record<string, unknown>
  >;
  return <Component {...value} />;
}

async function findModule(
  valModules: ValModules,
  moduleFilePath: string,
): Promise<ValModule<SelectorSource> | null> {
  for (const { def } of valModules.modules) {
    const valModule = (await def())?.default;
    if (valModule && Internal.getValPath(valModule) === moduleFilePath) {
      return valModule;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, monospace",
        fontSize: "13px",
        padding: "1rem",
      }}
    >
      {children}
    </div>
  );
}
