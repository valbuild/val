// No hooks in this file: `@valbuild/next` calls it from a Server Component.
// The bridge, which has them, is `ValPreviewBridgeCore.tsx`.
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
import type { ComponentType, ReactNode } from "react";
import { stegaEncode } from "../stega/stegaEncode";

/**
 * EXPERIMENTAL: the module a source path is in, looked up in the app's
 * `val.modules`. `null` when it is not registered.
 */
export async function findValModule(
  valModules: ValModules,
  sourcePath: string,
): Promise<ValModule<SelectorSource> | null> {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
    sourcePath as SourcePath,
  );
  for (const { def } of valModules.modules) {
    const valModule = (await def())?.default;
    // A module's path is its file path; `getValPath` types it as the wider
    // source path it is the root of.
    if (
      valModule &&
      String(Internal.getValPath(valModule)) === moduleFilePath
    ) {
      return valModule;
    }
  }
  return null;
}

export type ValComponentPreviewResolution =
  | {
      status: "ok";
      Component: ComponentType<Record<string, unknown>>;
      props: Record<string, unknown>;
    }
  | { status: "error"; message: string };

/**
 * EXPERIMENTAL: the component that renders the value at `sourcePath`, and the
 * props to render it with - the framework-free half of a component preview,
 * shared by `@valbuild/next` and `@valbuild/tanstack`.
 *
 * `moduleValue` is the module's content as the app reads it (`fetchVal`), not
 * its own source: a section added in the Studio is in the former and not the
 * latter, and only the content says which variant of a union a section is.
 *
 * With `example`, the props are the render's `example`; with `props`, those.
 * Neither is content, so neither carries edit tags: a click in the preview must
 * not lead to a field the value is not in.
 */
export async function resolveValComponentPreview({
  valModule,
  sourcePath,
  moduleValue,
  example,
  props,
}: {
  valModule: ValModule<SelectorSource>;
  sourcePath: string;
  moduleValue: unknown;
  example?: boolean;
  props?: unknown;
}): Promise<ValComponentPreviewResolution> {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
  const moduleSchema = Internal.getSchema(valModule);
  if (!moduleSchema) {
    return { status: "error", message: `'${moduleFilePath}' has no schema.` };
  }
  let schema = moduleSchema;
  let value: unknown = moduleValue;
  if (modulePath) {
    try {
      const resolved = Internal.resolvePath(
        modulePath,
        // What the app read is the module's source with media resolved,
        // which is what this walks.
        moduleValue as Source,
        moduleSchema,
      );
      schema = resolved.schema;
      value = resolved.source;
    } catch (err) {
      return {
        status: "error",
        message: `${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const render = getComponentRender(schema, value);
  if (!render) {
    return {
      status: "error",
      message: `${sourcePath} has no component: give its schema .render({ as: "component", component }) to preview it.`,
    };
  }

  if (props !== undefined || example) {
    const source = props !== undefined ? props : render.example;
    if (source === undefined) {
      return { status: "error", message: `${sourcePath} has no example.` };
    }
    value = stegaEncode(source, {
      disabled: true,
      root: { path: sourcePath, schema: schema["executeSerialize"]() },
    });
  }

  if (typeof value !== "object" || value === null) {
    return {
      status: "error",
      message: `Expected an object to spread as props, got ${
        value === null ? "null" : typeof value
      }.`,
    };
  }
  // Core cannot express a React component's type, and the lookup above is by
  // path, which erases the relation between the schema and its component that
  // `.render(...)` was given. These casts are what restore it - and the reason
  // this lives in the library instead of in every app with a preview.
  return {
    status: "ok",
    Component: (await loadComponent(render)) as ComponentType<
      Record<string, unknown>
    >,
    props: value as Record<string, unknown>,
  };
}

/** A message in place of the component, for when there is none to render. */
export function ValPreviewMessage({ children }: { children: ReactNode }) {
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
