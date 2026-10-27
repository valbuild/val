import {
  VAL_PREVIEW_MESSAGES,
  type ComponentView,
  type SerializedComponentRender,
  type SerializedDiscriminatedUnionSchema,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import {
  Eye,
  FlaskConical,
  Monitor,
  PenLine,
  RotateCw,
  Smartphone,
  Tablet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
 * How tall the component is taken to be until the preview has said how tall
 * it is - and for good, if the preview route does not wrap its output in
 * `ValPreviewBridge`.
 */
const UNMEASURED_HEIGHT_PX = 240;

/**
 * The screens split view can show the component on. Pressing Split again moves
 * to the next one. Mobile comes first: it is the narrowest, so it leaves the
 * fields beside it the most room.
 *
 * The component is laid out at the screen's width - capped by the render's
 * `maxWidth`, which is as wide as it ever gets - and scaled down to fit when
 * there is less room than that. Desktop is the `maxWidth` itself when there is
 * one, and a laptop's width when there is not.
 */
type SplitDevice = "mobile" | "tablet" | "desktop";

const SPLIT_DEVICES: {
  device: SplitDevice;
  label: string;
  icon: ReactNode;
  width: (maxWidth: number | undefined) => number;
}[] = [
  {
    device: "mobile",
    label: "Mobile",
    icon: <Smartphone size={14} />,
    width: (maxWidth) => Math.min(390, maxWidth ?? Infinity),
  },
  {
    device: "tablet",
    label: "iPad",
    icon: <Tablet size={14} />,
    width: (maxWidth) => Math.min(820, maxWidth ?? Infinity),
  },
  {
    device: "desktop",
    label: "Desktop",
    icon: <Monitor size={14} />,
    width: (maxWidth) => maxWidth ?? 1280,
  },
];

/**
 * Could a value with this schema have a component? Read off the schema alone:
 * an object that declares one, or a union with a variant that does.
 */
export function mayHaveComponent(schema: SerializedSchema): boolean {
  if (schema.type === "discriminated-union") {
    return schema.items.some((item) => componentRenderOf(item) !== null);
  }
  return componentRenderOf(schema) !== null;
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
 * EXPERIMENTAL: a field whose value has a component -
 * `s.object(...).render({ as: "component" })`, or a union whose current
 * variant is one. It is shown as the component, as its fields (`children`) or
 * both, starting from the render's `defaultView`, and switched on the field.
 *
 * When there is no component - a union whose current variant has none - the
 * fields are shown as they always are.
 */
export function ComponentField({
  path,
  schema,
  children,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  children: ReactNode;
}) {
  if (schema.type === "discriminated-union") {
    return (
      <UnionComponentField path={path} schema={schema}>
        {children}
      </UnionComponentField>
    );
  }
  const render = componentRenderOf(schema);
  if (!render) {
    return <>{children}</>;
  }
  return (
    <ComponentFieldLayout key={path} path={path} render={render}>
      {children}
    </ComponentFieldLayout>
  );
}

/**
 * A union has no render of its own: the variant the value takes does, and
 * which one that is can change while the editor is looking at it.
 */
function UnionComponentField({
  path,
  schema,
  children,
}: {
  path: SourcePath;
  schema: SerializedDiscriminatedUnionSchema;
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
  // Keyed by the variant too: another variant is another component, with a
  // default view, an example and a frame of its own.
  return (
    <ComponentFieldLayout
      key={`${path}:${String(tag)}`}
      path={path}
      render={render}
    >
      {children}
    </ComponentFieldLayout>
  );
}

/**
 * The toolbar - the view switch, Example and Reload - on top of the field,
 * and under it the component, the fields or both.
 *
 * Keyed by its caller on the path (and the variant), so navigating starts
 * over from the render's `defaultView` and from the content rather than the
 * example.
 */
function ComponentFieldLayout({
  path,
  render,
  children,
}: {
  path: SourcePath;
  render: SerializedComponentRender;
  children: ReactNode;
}) {
  const [view, setView] = useState<ComponentView>(
    render.defaultView ?? "split",
  );
  const [device, setDevice] = useState<SplitDevice>("mobile");
  const splitDevice =
    SPLIT_DEVICES.find((candidate) => candidate.device === device) ??
    SPLIT_DEVICES[0];
  // Split again, while in split, is the next screen
  const selectView = useCallback(
    (next: ComponentView) => {
      if (next === "split" && view === "split") {
        const index = SPLIT_DEVICES.findIndex(
          (candidate) => candidate.device === device,
        );
        setDevice(SPLIT_DEVICES[(index + 1) % SPLIT_DEVICES.length].device);
      } else {
        setView(next);
      }
    },
    [view, device],
  );
  const [showExample, setShowExample] = useState(false);
  // Bumped to throw the iframe away and mount a new one. Needed when the
  // component code changed (as opposed to its content), since that means the
  // host app has to re-evaluate the module, not just re-render it.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  // Component code changed outside of Val: reload from scratch.
  useEffect(() => {
    window.addEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    return () => {
      window.removeEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    };
  }, [reload]);

  const frame = (
    <PreviewFrame
      key={reloadKey}
      path={path}
      render={render}
      example={showExample}
      width={view === "split" ? splitDevice.width(render.maxWidth) : null}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 justify-between items-center">
        <ComponentViewSwitch
          view={view}
          splitDevice={splitDevice}
          onChange={selectView}
        />
        {view !== "content" && (
          <div className="flex gap-1 items-center">
            {render.example && (
              <ToolbarButton
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
              </ToolbarButton>
            )}
            <ToolbarButton
              label="Reload the preview (after the component code changed)"
              onClick={reload}
            >
              <RotateCw size={14} />
            </ToolbarButton>
          </div>
        )}
      </div>
      {view === "content" ? (
        children
      ) : view === "preview" ? (
        frame
      ) : (
        // Side by side when there is room for both, one above the other when
        // there is not. On mobile the preview takes the phone's width and the
        // fields the rest; on the wider screens the two share the room and
        // the preview is scaled down. It stays in view while the fields scroll.
        <div className="flex flex-wrap gap-6 items-start">
          <div
            className="sticky top-4 min-w-0"
            style={
              device === "mobile"
                ? {
                    flex: "0 1 auto",
                    width: splitDevice.width(render.maxWidth) + 2,
                    maxWidth: "100%",
                  }
                : { flex: "1 1 22rem" }
            }
          >
            {frame}
          </div>
          <div className="min-w-0" style={{ flex: "1 1 22rem" }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

const VIEW_OPTIONS: {
  view: ComponentView;
  label: string;
  icon: ReactNode;
}[] = [
  { view: "preview", label: "Preview", icon: <Eye size={14} /> },
  { view: "content", label: "Content", icon: <PenLine size={14} /> },
];

/**
 * Preview, Content and Split. Split shows the screen it is on, and pressing
 * it again moves to the next one.
 */
function ComponentViewSwitch({
  view,
  splitDevice,
  onChange,
}: {
  view: ComponentView;
  splitDevice: (typeof SPLIT_DEVICES)[number];
  onChange: (view: ComponentView) => void;
}) {
  const nextDevice =
    SPLIT_DEVICES[
      (SPLIT_DEVICES.indexOf(splitDevice) + 1) % SPLIT_DEVICES.length
    ];
  return (
    <div
      role="radiogroup"
      aria-label="Show"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border-primary"
    >
      {VIEW_OPTIONS.map((option) => (
        <ViewButton
          key={option.view}
          selected={view === option.view}
          onClick={() => onChange(option.view)}
        >
          {option.icon}
          {option.label}
        </ViewButton>
      ))}
      <ViewButton
        selected={view === "split"}
        title={
          view === "split"
            ? `Split, on ${splitDevice.label}. Press again for ${nextDevice.label}`
            : `Split, on ${splitDevice.label}`
        }
        onClick={() => onChange("split")}
      >
        {splitDevice.icon}
        Split
        <span className="text-fg-tertiary">{splitDevice.label}</span>
      </ViewButton>
    </div>
  );
}

function ViewButton({
  selected,
  title,
  onClick,
  children,
}: {
  selected: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={title}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 h-7 px-2 rounded text-xs transition-colors",
        {
          "bg-bg-secondary text-fg-primary": selected,
          "text-fg-tertiary hover:text-fg-primary": !selected,
        },
      )}
    >
      {children}
    </button>
  );
}

function ToolbarButton({
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

/**
 * The component, rendered by the host app in an iframe: that way it gets the
 * app's own React, CSS, fonts and providers, and server components work. Val
 * only decides which content it is rendered with.
 *
 * The frame is laid out at a width - the room there is, up to the render's
 * `maxWidth`, or in split view the width of the screen picked there - and
 * scaled down when there is less room than that. So split view on desktop
 * shows the component as it looks on a wide screen, in miniature, rather than
 * its narrow-screen layout.
 *
 * It is as tall as the component - which only the frame can measure, so it
 * reports it (see `ValPreviewBridge`) - unless the render has an
 * `aspectRatio`.
 */
function PreviewFrame({
  path,
  render,
  example,
  width,
}: {
  path: SourcePath;
  render: SerializedComponentRender;
  example: boolean;
  /**
   * The width to lay the component out at, scaled down when there is less
   * room. `null` is as wide as there is room, up to the render's `maxWidth`.
   */
  width: number | null;
}) {
  const sourceAtPath = useSourceAtPath(path);
  const source =
    sourceAtPath.status === "success" ? sourceAtPath.data : undefined;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = previewUrl({ path, example });

  // The room there is, which the frame is fitted into
  const containerRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const measure = () => setRoom(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
    };
  }, []);

  // A new document reports its own height; until it does, the old one's
  // would be a lie about something else.
  const [reportedHeight, setReportedHeight] = useState<number | null>(null);
  useEffect(() => {
    setReportedHeight(null);
  }, [src]);
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
        setReportedHeight(event.data.height);
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

  const layout = room === null ? null : frameLayout({ render, room, width });
  const height = layout
    ? render.aspectRatio
      ? layout.width / render.aspectRatio
      : (reportedHeight ?? UNMEASURED_HEIGHT_PX)
    : UNMEASURED_HEIGHT_PX;
  const scale = layout?.scale ?? 1;
  return (
    <div ref={containerRef} className="w-full">
      {layout && (
        <div
          className="mx-auto overflow-hidden rounded-lg border border-border-primary bg-bg-primary"
          // The border is outside the scaled frame, so it stays one pixel
          // wide however small the frame is drawn.
          style={{
            width: layout.width * scale + 2,
            height: height * scale + 2,
            maxWidth: "100%",
          }}
        >
          <iframe
            ref={iframeRef}
            title={`Preview of ${path}`}
            src={src}
            className="block border-0 origin-top-left"
            style={{
              width: layout.width,
              height,
              transform: scale === 1 ? undefined : `scale(${scale})`,
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The width the frame is laid out at, and how much it is scaled down to fit in
 * `room`. The frame's border takes 2px of the room.
 */
function frameLayout({
  render,
  room,
  width,
}: {
  render: SerializedComponentRender;
  room: number;
  width: number | null;
}): { width: number; scale: number } {
  const available = Math.max(room - 2, 1);
  if (width !== null) {
    return { width, scale: Math.min(1, available / width) };
  }
  return { width: Math.min(render.maxWidth ?? available, available), scale: 1 };
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
