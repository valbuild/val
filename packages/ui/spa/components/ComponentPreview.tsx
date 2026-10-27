import {
  VAL_PREVIEW_MESSAGES,
  type SerializedComponentRender,
  type SerializedDiscriminatedUnionSchema,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { Columns2, Eye, FlaskConical, PenLine, RotateCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShallowSourceAtPath, useSourceAtPath } from "./ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";
import { cn } from "./designSystem/cn";

/**
 * Route in the host app that renders the value at one source path with its
 * component.
 *
 * TODO: make configurable (val.config) - hard-coded while we figure out what
 * the right setup story is.
 */
const VAL_PREVIEW_ROUTE = "/val-preview";

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
 * How tall the frame is until the preview has said how tall it is - and for
 * good, if the preview route does not wrap its output in `ValPreviewBridge`.
 */
const UNMEASURED_HEIGHT_PX = 240;

/**
 * How a value that has a component is shown: rendered, as its fields, or both
 * side by side.
 */
export type ComponentView = "preview" | "content" | "split";

const COMPONENT_VIEWS: ComponentView[] = ["preview", "content", "split"];
const COMPONENT_VIEW_STORAGE_KEY = "val:component-view";

/**
 * Could a value with this schema have a component? Read off the schema alone,
 * so the switch can be shown before the value has loaded: an object that
 * declares one, or a union with a variant that does.
 */
export function mayHaveComponent(schema: SerializedSchema): boolean {
  if (schema.type === "discriminated-union") {
    return schema.items.some((item) => componentRenderOf(item) !== null);
  }
  return componentRenderOf(schema) !== null;
}

/**
 * The view the editor last chose, remembered per browser: a convenience on
 * one machine, so `localStorage`, and nothing breaks when it is unavailable.
 */
export function useComponentView(): [
  ComponentView,
  (view: ComponentView) => void,
] {
  const [view, setView] = useState<ComponentView>(readComponentView);
  const select = useCallback((next: ComponentView) => {
    setView(next);
    try {
      localStorage.setItem(COMPONENT_VIEW_STORAGE_KEY, next);
    } catch {
      // Not remembered next time; the switch still works.
    }
  }, []);
  return [view, select];
}

function readComponentView(): ComponentView {
  try {
    const stored = localStorage.getItem(COMPONENT_VIEW_STORAGE_KEY);
    const known = COMPONENT_VIEWS.find((view) => view === stored);
    if (known) {
      return known;
    }
  } catch {
    // Storage blocked: fall through to the default.
  }
  return "split";
}

const VIEW_OPTIONS: {
  view: ComponentView;
  label: string;
  icon: ReactNode;
}[] = [
  { view: "preview", label: "Preview", icon: <Eye size={14} /> },
  { view: "content", label: "Content", icon: <PenLine size={14} /> },
  { view: "split", label: "Split", icon: <Columns2 size={14} /> },
];

/** The switch between the three {@link ComponentView}s, beside the heading. */
export function ComponentViewSwitch({
  view,
  onChange,
}: {
  view: ComponentView;
  onChange: (view: ComponentView) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border-primary"
    >
      {VIEW_OPTIONS.map((option) => {
        const selected = option.view === view;
        return (
          <button
            key={option.view}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.view)}
            className={cn(
              "flex items-center gap-1.5 h-7 px-2 rounded text-xs transition-colors",
              {
                "bg-bg-secondary text-fg-primary": selected,
                "text-fg-tertiary hover:text-fg-primary": !selected,
              },
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * EXPERIMENTAL: the value at `path` laid out by `view` - rendered with the
 * component its schema declares, as its fields (`children`), or both.
 *
 * The component is `s.object(...).render({ as: "component" })`, or the one of
 * the variant a union's value takes. When there is none - a union whose
 * current variant has no component - the fields are shown as they always are.
 */
export function ComponentLayout({
  path,
  schema,
  view,
  children,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  view: ComponentView;
  children: ReactNode;
}) {
  if (schema.type === "discriminated-union") {
    return (
      <UnionComponentLayout path={path} schema={schema} view={view}>
        {children}
      </UnionComponentLayout>
    );
  }
  const render = componentRenderOf(schema);
  if (!render) {
    return <>{children}</>;
  }
  return (
    <ViewLayout path={path} render={render} view={view}>
      {children}
    </ViewLayout>
  );
}

/**
 * A union has no render of its own: the variant the value takes does, and
 * which one that is can change while the editor is looking at it.
 */
function UnionComponentLayout({
  path,
  schema,
  view,
  children,
}: {
  path: SourcePath;
  schema: SerializedDiscriminatedUnionSchema;
  view: ComponentView;
  children: ReactNode;
}) {
  const tagRes = useShallowSourceAtPath(
    sourcePathOfItem(path, schema.key),
    "literal",
  );
  const tag = "data" in tagRes ? tagRes.data : undefined;
  const variant = schema.items.find((item) => {
    const tagSchema = item.items[schema.key];
    return tagSchema?.type === "literal" && tagSchema.value === tag;
  });
  const render = variant ? componentRenderOf(variant) : null;
  if (!render) {
    return <>{children}</>;
  }
  return (
    <ViewLayout path={path} render={render} view={view} variant={String(tag)}>
      {children}
    </ViewLayout>
  );
}

function ViewLayout({
  path,
  render,
  view,
  variant,
  children,
}: {
  path: SourcePath;
  render: SerializedComponentRender;
  view: ComponentView;
  /** Another variant is another component: its frame starts over. */
  variant?: string;
  children: ReactNode;
}) {
  if (view === "content") {
    return <>{children}</>;
  }
  const frame = <PreviewFrame key={variant} path={path} render={render} />;
  if (view === "preview") {
    return frame;
  }
  // Side by side when there is room for both, one above the other when there
  // is not: a column narrower than two of the minimum wraps the fields under
  // the preview. The preview stays in view while the fields beside it scroll.
  return (
    <div className="grid gap-6 items-start grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]">
      <div className="sticky top-4">{frame}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function componentRenderOf(
  schema: SerializedSchema,
): SerializedComponentRender | null {
  if (schema.type !== "object") {
    return null;
  }
  return schema.render?.as === "component" ? schema.render : null;
}

/**
 * The component, rendered by the host app in an iframe: that way it gets the
 * app's own React, CSS, fonts and providers, and server components work. Val
 * only decides which content it is rendered with.
 *
 * As wide as there is room for up to the render's `maxWidth`, and as tall as
 * the component - which only the frame can measure, so it reports it (see
 * `ValPreviewBridge`) - unless the render gives an `aspectRatio`.
 */
function PreviewFrame({
  path,
  render,
}: {
  path: SourcePath;
  render: SerializedComponentRender;
}) {
  const sourceAtPath = useSourceAtPath(path);
  const source =
    sourceAtPath.status === "success" ? sourceAtPath.data : undefined;
  const [showExample, setShowExample] = useState(false);
  // Navigating to another value starts on its content
  useEffect(() => {
    setShowExample(false);
  }, [path]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // Bumped to throw the iframe away and mount a new one. Needed when the
  // component code changed (as opposed to its content), since that means the
  // host app has to re-evaluate the module, not just re-render it.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);
  const src = previewUrl({ path, example: showExample });

  // A new document reports its own height; until it does, the old one's
  // would be a lie about something else.
  useEffect(() => {
    setHeight(null);
  }, [src, reloadKey]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      // Only this frame's own document: every preview on the page posts the
      // same message.
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (
        event.data?.type === VAL_PREVIEW_MESSAGES.size &&
        typeof event.data.height === "number"
      ) {
        setHeight(event.data.height);
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, []);

  // Content changed in Val: ask the preview to re-render with the new content.
  const isFirstSourceRef = useRef(true);
  useEffect(() => {
    if (source === undefined) {
      // Still loading: arriving is not a change
      return;
    }
    if (isFirstSourceRef.current) {
      // The iframe is loading the current content anyway
      isFirstSourceRef.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: VAL_PREVIEW_MESSAGES.refresh },
        window.location.origin,
      );
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [source]);

  // Component code changed outside of Val: reload from scratch.
  useEffect(() => {
    window.addEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    return () => {
      window.removeEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    };
  }, [reload]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1 justify-end items-center">
        {render.example && (
          <FrameButton
            label={
              showExample
                ? "Showing the example. Show the content instead"
                : "Show the example: a fixture, not content on the site"
            }
            pressed={showExample}
            onClick={() => setShowExample((prev) => !prev)}
          >
            <FlaskConical size={14} />
            Example
          </FrameButton>
        )}
        <FrameButton
          label="Reload the preview (after the component code changed)"
          onClick={reload}
        >
          <RotateCw size={14} />
        </FrameButton>
      </div>
      <iframe
        key={reloadKey}
        ref={iframeRef}
        title={`Preview of ${path}`}
        src={src}
        style={{
          maxWidth: render.maxWidth,
          ...(render.aspectRatio
            ? { aspectRatio: render.aspectRatio }
            : { height: height ?? UNMEASURED_HEIGHT_PX }),
        }}
        className="block w-full mx-auto rounded-lg border border-border-primary bg-bg-primary"
      />
    </div>
  );
}

function FrameButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 h-7 px-2 rounded text-xs transition-colors",
        {
          "bg-bg-secondary text-fg-primary": pressed,
          "text-fg-tertiary hover:text-fg-primary": !pressed,
        },
      )}
    >
      {children}
    </button>
  );
}

function previewUrl({
  path,
  example,
}: {
  path: SourcePath;
  example?: boolean;
}): string {
  const params = new URLSearchParams({ p: path });
  if (example) {
    params.set("example", "1");
  }
  return `${VAL_PREVIEW_ROUTE}?${params.toString()}`;
}
