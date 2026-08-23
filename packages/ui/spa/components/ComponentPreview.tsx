import {
  getValFileLocation,
  Internal,
  isComponentModule,
  type ModuleFilePath,
  type SourcePath,
  type ValFileLocation,
} from "@valbuild/core";
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useValModules } from "../hooks/useValModules";
import { useAllSources, useSchemas } from "./ValFieldProvider";
import { findSchemaUsages, type SchemaUsage } from "./findSchemaUsages";
import { cn } from "./designSystem/cn";

/**
 * Route in the host app that renders a single component module.
 *
 * TODO: make configurable (val.config) - hard-coded while we figure out what
 * the right setup story is.
 */
const VAL_PREVIEW_ROUTE = "/val-preview";
const VAL_PREVIEW_REFRESH_MESSAGE = "val-preview-refresh";

/**
 * Window event that forces a full reload of every component preview.
 *
 * Component code is rewritten outside of Val, so Val cannot know when that
 * happened: whatever performs the rewrite dispatches this when it is done.
 *
 * @example
 * window.dispatchEvent(new CustomEvent("val-component-preview-reload"));
 */
export const VAL_COMPONENT_PREVIEW_RELOAD_EVENT =
  "val-component-preview-reload";

/**
 * How long to wait after the last edit before telling the preview to refresh.
 *
 * The preview is rendered by the host app's server, so it only sees a change
 * once the patch has been synced. Debouncing also keeps us from refreshing on
 * every keystroke.
 */
const REFRESH_DEBOUNCE_MS = 800;

/**
 * Every module defined with `c.component`, by module file path.
 *
 * Read from the app's own `val.modules` registry (which the host app puts on
 * `window.__VAL_MODULES__`), so the fact that a module is a component module
 * never has to travel through the schema serialization.
 */
export function useComponentModules(): ReadonlyMap<string, ValFileLocation> {
  const valModules = useValModules();
  const [components, setComponents] = useState<Map<string, ValFileLocation>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!valModules) {
      return;
    }
    let cancelled = false;
    Promise.all(
      valModules.modules.map(async ({ def }) => {
        try {
          const valModule = (await def())?.default;
          if (!valModule || !isComponentModule(valModule)) {
            return null;
          }
          const modulePath = Internal.getValPath(valModule);
          if (!modulePath) {
            return null;
          }
          return getValFileLocation(
            modulePath as string as ModuleFilePath,
            valModules.config,
          );
        } catch (err) {
          console.error(
            "Val: could not load module while looking for components",
            err,
          );
          return null;
        }
      }),
    ).then((maybeComponents) => {
      if (cancelled) {
        return;
      }
      setComponents(
        new Map(
          maybeComponents
            .filter(
              (component): component is ValFileLocation => component !== null,
            )
            .map((component) => [component.modulePath, component]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [valModules]);
  return components;
}

/**
 * Every place in content where this component's schema is used.
 *
 * @see findSchemaUsages for how "the same schema" is decided (structurally, so
 * a usage is a candidate rather than a proof - which is why a usage can name
 * more than one component).
 */
function useUsagesOf(componentPath: ModuleFilePath | null): {
  usages: SchemaUsage[];
  truncated: boolean;
} {
  const componentModules = useComponentModules();
  const schemasRes = useSchemas();
  const sources = useAllSources();
  return useMemo(() => {
    if (!componentPath || schemasRes.status !== "success") {
      return { usages: [], truncated: false };
    }
    const { usages, truncated } = findSchemaUsages(schemasRes.data, sources, [
      ...componentModules.keys(),
    ] as ModuleFilePath[]);
    return {
      usages: usages.filter((usage) =>
        usage.componentPaths.includes(componentPath),
      ),
      truncated,
    };
  }, [componentPath, componentModules, schemasRes, sources]);
}

type PreviewSource =
  /** The component module's own default content (the fixture). */
  | { type: "default" }
  /** A real place in content where the section is used. */
  | { type: "usage"; usage: SchemaUsage }
  /** Values typed in by hand, written nowhere. */
  | { type: "values" };

/**
 * EXPERIMENTAL: a live preview of a `c.component` module.
 *
 * Renders nothing unless the module at `path` was defined with `c.component`.
 *
 * The component itself is rendered by the host app (in an iframe), not here:
 * that way it gets the app's own React, CSS, fonts and providers, and server
 * components work. Val UI only decides which content to render it with.
 */
export function ComponentPreview({ path }: { path: SourcePath }) {
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(path),
    [path],
  );
  const componentModules = useComponentModules();
  const component = componentModules.get(moduleFilePath);
  const componentPath = component
    ? (component.modulePath as ModuleFilePath)
    : null;
  const { usages, truncated } = useUsagesOf(componentPath);
  const sources = useAllSources();
  const source = sources[moduleFilePath as ModuleFilePath];

  // Real usages lead: the default content is a fixture, so it is only what we
  // fall back to when the section is not used anywhere yet.
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(
    null,
  );
  // Reset when navigating to another component
  useEffect(() => {
    setPreviewSource(null);
  }, [moduleFilePath]);
  const selected: PreviewSource =
    previewSource ??
    (usages.length > 0
      ? { type: "usage", usage: usages[0] }
      : { type: "default" });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isFirstSourceRef = useRef(true);
  // Bumped to throw the iframe away and mount a new one. Needed when the
  // component code changed (as opposed to its content), since that means the
  // host app has to re-evaluate the module, not just re-render it.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  // Content changed in Val: ask the preview to re-render with the new content.
  useEffect(() => {
    if (!component) {
      return;
    }
    if (isFirstSourceRef.current) {
      // The iframe is loading the current content anyway
      isFirstSourceRef.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: VAL_PREVIEW_REFRESH_MESSAGE },
        window.location.origin,
      );
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [source, component]);

  // Component code changed outside of Val: reload from scratch.
  useEffect(() => {
    window.addEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    return () => {
      window.removeEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    };
  }, [reload]);

  if (!component || !componentPath) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 justify-between items-center text-xs text-fg-tertiary">
        <span
          className="font-mono truncate"
          title="The file that defines this component"
        >
          {component.repoFilePath}
        </span>
        <button
          type="button"
          className="flex gap-1 items-center shrink-0 hover:text-fg-primary"
          onClick={reload}
          title="Reload the preview (after the component code changed)"
        >
          <RotateCw size={12} />
          Reload
        </button>
      </div>
      <PreviewSourcePicker
        usages={usages}
        truncated={truncated}
        selected={selected}
        onSelect={setPreviewSource}
      />
      {selected.type === "values" ? (
        <ValuesPreview componentPath={componentPath} initialValue={source} />
      ) : (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title={`Preview of ${componentPath}`}
          src={previewUrl({
            componentPath,
            sourcePath:
              selected.type === "usage" ? selected.usage.sourcePath : null,
          })}
          className="w-full h-[420px] rounded-lg border border-border-primary bg-bg-primary"
        />
      )}
    </div>
  );
}

function PreviewSourcePicker({
  usages,
  truncated,
  selected,
  onSelect,
}: {
  usages: SchemaUsage[];
  truncated: boolean;
  selected: PreviewSource;
  onSelect: (source: PreviewSource) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 items-center text-xs">
      {usages.length === 0 && (
        <span className="text-fg-tertiary">Not used in content yet</span>
      )}
      {usages.map((usage) => (
        <PickerButton
          key={usage.sourcePath}
          selected={
            selected.type === "usage" &&
            selected.usage.sourcePath === usage.sourcePath
          }
          onClick={() => onSelect({ type: "usage", usage })}
          title={
            usage.componentPaths.length > 1
              ? `${usage.sourcePath}\nAlso matches: ${usage.componentPaths.join(", ")}`
              : usage.sourcePath
          }
        >
          {usageLabel(usage)}
          {usage.componentPaths.length > 1 && (
            <span className="ml-1 text-fg-tertiary">
              +{usage.componentPaths.length - 1}
            </span>
          )}
        </PickerButton>
      ))}
      <PickerButton
        selected={selected.type === "default"}
        onClick={() => onSelect({ type: "default" })}
        title="The default content of the component module - a fixture, not necessarily content that exists on the site"
      >
        Default content
      </PickerButton>
      <PickerButton
        selected={selected.type === "values"}
        onClick={() => onSelect({ type: "values" })}
        title="Render this component with values you type in, without changing any content"
      >
        Values&hellip;
      </PickerButton>
      {truncated && (
        <span className="text-fg-tertiary">
          (more usages exist than are listed)
        </span>
      )}
    </div>
  );
}

function PickerButton({
  selected,
  onClick,
  title,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn("px-2 py-1 rounded border border-border-primary", {
        "bg-bg-secondary text-fg-primary": selected,
        "text-fg-tertiary hover:text-fg-primary": !selected,
      })}
    >
      {children}
    </button>
  );
}

/**
 * Render the component with values typed in by hand.
 *
 * The values are sent as JSON in the preview URL, so they are never written
 * anywhere: the preview is still rendered by the host app's server, which keeps
 * server components working.
 */
function ValuesPreview({
  componentPath,
  initialValue,
}: {
  componentPath: ModuleFilePath;
  initialValue: unknown;
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(initialValue ?? {}, null, 2),
  );
  const [committed, setCommitted] = useState(text);
  useEffect(() => {
    const timeout = setTimeout(() => setCommitted(text), 500);
    return () => clearTimeout(timeout);
  }, [text]);
  const parseError = useMemo(() => {
    try {
      JSON.parse(committed);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid JSON";
    }
  }, [committed]);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="w-full h-40 p-2 font-mono text-xs rounded-lg border border-border-primary bg-bg-primary text-fg-primary"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {parseError ? (
        <div className="text-xs text-fg-error-primary">{parseError}</div>
      ) : (
        <iframe
          title={`Preview of ${componentPath} with typed values`}
          src={previewUrl({ componentPath, props: committed })}
          className="w-full h-[420px] rounded-lg border border-border-primary bg-bg-primary"
        />
      )}
    </div>
  );
}

function previewUrl({
  componentPath,
  sourcePath,
  props,
}: {
  componentPath: ModuleFilePath;
  sourcePath?: SourcePath | null;
  props?: string;
}): string {
  const params = new URLSearchParams({ c: componentPath });
  if (sourcePath) {
    params.set("p", sourcePath);
  }
  if (props !== undefined) {
    params.set("props", props);
  }
  return `${VAL_PREVIEW_ROUTE}?${params.toString()}`;
}

/**
 * A short label for a usage: the module file name plus the path within it.
 */
function usageLabel(usage: SchemaUsage): string {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    usage.sourcePath,
  );
  const fileName =
    usage.moduleFilePath
      .split("/")
      .pop()
      ?.replace(/\.val\.\w+$/, "") ?? usage.moduleFilePath;
  if (!modulePath) {
    return fileName;
  }
  return `${fileName}: ${Internal.splitModulePath(modulePath).join(".")}`;
}
