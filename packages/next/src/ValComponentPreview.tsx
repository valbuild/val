import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  getComponent,
  getValFileLocation,
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValFileLocation,
  type ValModule,
  type ValModules,
} from "@valbuild/core";

export type ValComponentPreviewOptions = {
  /** The app's `val.modules` registry (the default export of val.modules.ts). */
  valModules: ValModules;
  /**
   * Module file path of the component module to render, e.g.
   * `/app/sections/hero.val.tsx`.
   */
  componentPath: string;
  /**
   * Source path to take the props from. Defaults to `componentPath`, i.e. the
   * component module's own example content.
   *
   * Point it at a usage elsewhere in content - e.g.
   * `/content/pages.val.ts?p="/about"."sections".0` - to see the component
   * with the content it actually renders on the site.
   */
  sourcePath?: string | null;
  /**
   * Props to render with, overriding `sourcePath`. For trying out values
   * without changing any content.
   *
   * NOTE: these are used as-is, so anything the normal read path converts
   * (image and file sources gain a `url`) has to already be in that shape.
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
 * EXPERIMENTAL: renders the component of a `c.component` module, with content
 * from anywhere in the project as its props.
 *
 * Meant to be called from a Server Component behind a route that the Val UI
 * loads in an iframe, so an editor can see the section they are editing - and
 * see it with the content of every place it is used.
 *
 * This is a plain async function rather than a component because React 18
 * types do not allow async components in JSX. Call it and return the result:
 *
 * @example
 * // app/val-preview/page.tsx
 * export default async function ValPreviewPage({ searchParams }) {
 *   const { c, p } = searchParams;
 *   return unstable_renderValComponent({
 *     valModules,
 *     componentPath: c,
 *     sourcePath: p,
 *     fetchVal,
 *   });
 * }
 */
export async function unstable_renderValComponent({
  valModules,
  componentPath,
  sourcePath,
  props,
  fetchVal,
}: ValComponentPreviewOptions): Promise<ReactElement> {
  const modulesByPath = await loadModulesByPath(valModules);
  const componentModule = modulesByPath.get(componentPath);
  if (!componentModule) {
    const known = [...modulesByPath.keys()].filter((path) =>
      getComponent(modulesByPath.get(path)),
    );
    return (
      <PreviewMessage>
        {`No module '${componentPath}' in val.modules.${
          known.length > 0 ? ` Component modules: ${known.join(", ")}.` : ""
        }`}
      </PreviewMessage>
    );
  }
  const component = getComponent(componentModule);
  if (typeof component !== "function") {
    return (
      <PreviewMessage>
        {`'${componentPath}' is not a component module: define it with c.component to preview it.`}
      </PreviewMessage>
    );
  }

  let value: unknown;
  if (props !== undefined) {
    value = props;
  } else {
    const path = sourcePath || componentPath;
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path as SourcePath);
    const sourceModule = modulesByPath.get(moduleFilePath);
    if (!sourceModule) {
      return (
        <PreviewMessage>
          {`No module '${moduleFilePath}' in val.modules (needed for source path '${path}').`}
        </PreviewMessage>
      );
    }
    const moduleValue = await fetchVal(sourceModule);
    const parts = modulePath ? Internal.splitModulePath(modulePath) : [];
    const resolved = resolveIn(moduleValue, parts);
    if ("error" in resolved) {
      return <PreviewMessage>{`${path}: ${resolved.error}`}</PreviewMessage>;
    }
    value = resolved.value;
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
  // The lookup above is by path, which erases the type relation between the
  // module and its component that c.component establishes at definition time.
  // These casts are what restores it - they are the reason this helper lives in
  // the library instead of in every app that wants a preview.
  const Component = component as ComponentType<Record<string, unknown>>;
  return <Component {...value} />;
}

async function loadModulesByPath(
  valModules: ValModules,
): Promise<Map<string, ValModule<SelectorSource>>> {
  const modulesByPath = new Map<string, ValModule<SelectorSource>>();
  for (const { def } of valModules.modules) {
    const valModule = (await def())?.default;
    const modulePath = valModule && Internal.getValPath(valModule);
    if (valModule && modulePath) {
      modulesByPath.set(modulePath, valModule);
    }
  }
  return modulesByPath;
}

function resolveIn(
  value: unknown,
  parts: string[],
): { value: unknown } | { error: string } {
  let current = value;
  for (const part of parts) {
    if (!isRecord(current)) {
      return {
        error: `cannot read '${part}' of ${
          current === null ? "null" : typeof current
        }`,
      };
    }
    current = current[part];
    if (current === undefined) {
      return { error: `no value at '${part}'` };
    }
  }
  return { value: current };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Every `c.component` module in the registry, with the file that defines it.
 *
 * The rewrite of a component happens outside of Val: this is what tells the
 * outside which file to change.
 */
export async function unstable_getValComponents(
  valModules: ValModules,
): Promise<ValFileLocation[]> {
  const components: ValFileLocation[] = [];
  for (const { def } of valModules.modules) {
    const valModule = (await def())?.default;
    const modulePath = valModule && Internal.getValPath(valModule);
    if (modulePath && getComponent(valModule)) {
      components.push(
        getValFileLocation(
          modulePath as string as ModuleFilePath,
          valModules.config,
        ),
      );
    }
  }
  return components;
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
