// No hooks in this file: `@valbuild/next` calls it from a Server Component.
// The bridge, which has them, is `ValPreviewBridgeCore.tsx`.
import {
  componentPropsOf,
  getComponentRender,
  Internal,
  loadComponent,
  setComponentOfValue,
  type Schema,
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
      message: `${sourcePath} has no component: give its schema .component(() => import(...)) to preview it.`,
    };
  }

  if (props !== undefined || example) {
    const source = props !== undefined ? props : render.example;
    if (source === undefined) {
      return { status: "error", message: `${sourcePath} has no example.` };
    }
    value = stegaEncode(source, {
      disabled: true,
      root: {
        path: sourcePath,
        schema: schema["executeSerialize"](),
        // So a list of components inside the example has its components
        instance: schema,
      },
    });
  } else {
    linkComponents(value, schema);
  }

  // What the site hands the component (`ValComponentEditor`): the value, or
  // what the schema's `props` function makes of it. One function for both, so
  // the preview cannot show a component the site renders differently.
  const componentProps = componentPropsOf(render, value);
  if (typeof componentProps !== "object" || componentProps === null) {
    return {
      status: "error",
      message: `Expected an object to spread as props, got ${
        componentProps === null ? "null" : typeof componentProps
      }.`,
    };
  }
  // Core cannot express a React component's type, and the lookup above is by
  // path, which erases the relation between the schema and its component that
  // `.component(...)` was given. These casts are what restore it - and the
  // reason this lives in the library instead of in every app with a preview.
  return {
    status: "ok",
    Component: (await loadComponent(render)) as ComponentType<
      Record<string, unknown>
    >,
    props: componentProps as Record<string, unknown>,
  };
}

/**
 * Give every object inside `value` the component its schema links it to,
 * as a reader does (`stegaEncode`), for a value that lost them on the way.
 *
 * A preview's content often has: on TanStack the route's loader reads it in a
 * server function, and what comes back is JSON, which a component cannot
 * ride on. The component being previewed is found by path either way, but
 * one that renders a list of components of its own (`ValComponentEditor`)
 * would be handed items with nothing to render them with.
 *
 * Looked up from the root by each object's path - through whichever variant
 * of a union the value there takes - which is the reader's own way of
 * finding one. A path that cannot be resolved has no component, as before.
 */
function linkComponents(value: unknown, schema: Schema<SelectorSource>) {
  const visit = (node: unknown, path: string[]) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, [...path, String(index)]));
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    // The root is the previewed component itself, which the caller renders
    if (path.length > 0) {
      try {
        const at = Internal.resolvePath(
          Internal.patchPathToModulePath(path),
          // What the app read is the source with media resolved, which is
          // what `resolvePath` walks: see `resolveValComponentPreview`.
          value as Source,
          schema,
        );
        const render = getComponentRender(at.schema, at.source);
        if (render) {
          setComponentOfValue(node, render);
        }
      } catch {
        // Not a path the schema knows: nothing to link
      }
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, [...path, key]);
    }
  };
  visit(value, []);
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
