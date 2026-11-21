import {
  Internal,
  type Json,
  type JsonArray,
  type JsonObject,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import {
  ArrowLeft,
  Blocks,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  LayoutGrid,
  Monitor,
  MousePointerClick,
  RotateCw,
  Send,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../designSystem/cn";
import { Button } from "../designSystem/button";
import { Spinner } from "../designSystem/spinner";
import { useAllSources, useSchemas } from "../ValFieldProvider";
import { Module } from "../Module";
import { scrollToStudioPath } from "../ValRouter";
import { useAIChatActions } from "../AIChatActionsContext";
import { useDescriptions } from "../useDescriptions";
import {
  collectComponents,
  type StudioComponent,
} from "../../utils/collectComponents";
import {
  COMPONENT_REQUESTS,
  componentAssistantPrompt,
  contentLabelOf,
  pageRouteOf,
  VAL_COMPONENT_PREVIEW_ROUTE,
} from "../../utils/componentReview";
import { ComponentFrame, type ComponentFrameStatus } from "./ComponentFrame";
import {
  DEVICES,
  readComponentsUrlState,
  writeComponentsUrlState,
  type ComponentsUrlState,
  type Device,
} from "./componentsUrlState";

/**
 * EXPERIMENTAL: the Studio's Components view, at `/val/components`.
 *
 * Every component the project links to an object
 * (`s.object(...).component(() => import(...))`), rendered by the site
 * itself on its preview route, and every place the content uses each one.
 *
 * - **The board**: all of them side by side, each as it first appears in the
 *   content (or its example, when nothing uses it), at one screen width.
 * - **One component**: the component large, stepped through instance by
 *   instance (← and →), or all its instances side by side; its example; its
 *   fields beside it, and the assistant, told which component this is and
 *   where it lives, for changing the component itself.
 *
 * It is the whole editor column rather than a panel: a component is looked
 * at across the project, not inside one page.
 */
export function ComponentsView() {
  const schemasRes = useSchemas();
  const sources = useAllSources();
  const schemas = schemasRes.status === "success" ? schemasRes.data : null;
  const components = useMemo(
    () => (schemas === null ? null : collectComponents(schemas, sources)),
    [schemas, sources],
  );
  const [state, setState] = useState<ComponentsUrlState>(() =>
    readComponentsUrlState(window.location.search),
  );
  const update = useCallback((next: Partial<ComponentsUrlState>) => {
    setState((current) => {
      const merged = { ...current, ...next };
      writeComponentsUrlState(merged);
      return merged;
    });
  }, []);
  // The back button moves through the view's own states
  useEffect(() => {
    const onPop = () =>
      setState(readComponentsUrlState(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (components === null || schemas === null) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-fg-secondary">
        <Spinner />
      </div>
    );
  }
  if (components.length === 0) {
    return <NoComponents />;
  }
  const selected =
    state.component === null
      ? null
      : (components.find((component) => component.id === state.component) ??
        null);
  if (selected === null) {
    return (
      <Board
        components={components}
        sources={sources}
        device={state.device}
        onDevice={(device) => update({ device })}
        onOpen={(component) =>
          update({ component: component.id, instance: 0, example: false })
        }
        missing={state.component !== null}
      />
    );
  }
  return (
    <ComponentDetail
      key={selected.id}
      component={selected}
      components={components}
      schemas={schemas}
      sources={sources}
      state={state}
      update={update}
    />
  );
}

/** The content of the module a path is in, by reference: what changes on an edit to it. */
function moduleSourceOf(
  sources: Record<ModuleFilePath, Json>,
  path: SourcePath,
): Json | undefined {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  return sources[moduleFilePath];
}

function sourceAt(
  sources: Record<ModuleFilePath, Json>,
  path: SourcePath,
): Json | undefined {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  let current: Json | undefined = sources[moduleFilePath];
  if (!modulePath) return current;
  for (const segment of Internal.splitModulePath(modulePath)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = isJsonArray(current)
      ? current[Number(segment)]
      : current[segment];
  }
  return current;
}

function isJsonArray(value: JsonObject | JsonArray): value is JsonArray {
  return Array.isArray(value);
}

/** The project has no linked components: say what one is, and how to make one. */
function NoComponents() {
  return (
    <div className="max-w-xl p-8 mx-auto text-fg-secondary">
      <div className="flex items-center gap-2 mb-3 text-fg-primary">
        <Blocks size={18} />
        <h1 className="text-lg font-medium">Components</h1>
      </div>
      <p className="mb-3">
        This project does not link any components to its content yet. Link one
        to an object in a <code>.val.ts</code> file, and it shows up here with
        every place it is used:
      </p>
      <pre className="p-3 mb-3 overflow-x-auto text-xs rounded-md bg-bg-secondary text-fg-primary">
        {`const hero = s
  .object({ type: s.literal("hero"), title: s.string() })
  .component(() => import("../components/Hero"), {
    example: { type: "hero", title: "A long title" },
  });`}
      </pre>
      <p>
        Components render in the Studio through the site&apos;s own{" "}
        <code>{VAL_COMPONENT_PREVIEW_ROUTE}</code> route.
      </p>
    </div>
  );
}

function DeviceSwitch({
  device,
  onDevice,
}: {
  device: Device;
  onDevice: (device: Device) => void;
}) {
  const icons: Record<Device, ReactNode> = {
    mobile: <Smartphone size={14} />,
    tablet: <Tablet size={14} />,
    desktop: <Monitor size={14} />,
  };
  return (
    <div
      role="radiogroup"
      aria-label="Screen"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border-primary"
    >
      {DEVICES.map((option) => (
        <button
          key={option.device}
          type="button"
          role="radio"
          aria-checked={device === option.device}
          aria-label={`${option.label}, ${option.width}px`}
          title={`${option.label}, ${option.width}px`}
          onClick={() => onDevice(option.device)}
          className={cn(
            "flex items-center justify-center h-7 w-8 rounded transition-colors",
            device === option.device
              ? "bg-bg-secondary text-fg-primary"
              : "text-fg-tertiary hover:text-fg-primary",
          )}
        >
          {icons[option.device]}
        </button>
      ))}
    </div>
  );
}

function widthOf(device: Device): number {
  return (
    DEVICES.find((option) => option.device === device)?.width ??
    DEVICES[DEVICES.length - 1].width
  );
}

/** Every component, side by side. */
function Board({
  components,
  sources,
  device,
  onDevice,
  onOpen,
  missing,
}: {
  components: StudioComponent[];
  sources: Record<ModuleFilePath, Json>;
  device: Device;
  onDevice: (device: Device) => void;
  onOpen: (component: StudioComponent) => void;
  /** The address named a component that is not there (any more). */
  missing: boolean;
}) {
  const uses = components.reduce(
    (sum, component) => sum + component.instances.length,
    0,
  );
  const [noAnswer, setNoAnswer] = useState(false);
  return (
    <div className="flex flex-col min-h-full" data-testid="components-board">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b bg-bg-primary border-border-primary">
        <div className="flex items-center gap-2">
          <Blocks size={18} className="text-fg-secondary" />
          <h1 className="text-base font-medium text-fg-primary">Components</h1>
          <span className="text-sm text-fg-tertiary">
            {components.length}{" "}
            {components.length === 1 ? "component" : "components"} · {uses}{" "}
            {uses === 1 ? "use" : "uses"}
          </span>
        </div>
        <DeviceSwitch device={device} onDevice={onDevice} />
      </header>
      {missing && (
        <p className="px-4 pt-3 text-sm text-fg-secondary">
          The component in the address is not in the project any more, or its
          fields changed. Pick it again below.
        </p>
      )}
      {noAnswer && <NoPreviewRoute />}
      <ul
        className="grid gap-4 p-4"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${device === "mobile" ? 220 : 300}px, 1fr))`,
        }}
      >
        {components.map((component) => {
          const first = component.instances[0];
          return (
            <li key={component.id}>
              <button
                type="button"
                onClick={() => onOpen(component)}
                data-testid={`component-card-${component.name}`}
                className="flex flex-col w-full overflow-hidden text-left transition-colors border rounded-lg border-border-primary hover:border-border-secondary bg-bg-primary group"
              >
                <div className="w-full border-b border-border-primary bg-bg-secondary">
                  {first !== undefined ? (
                    <ComponentFrame
                      path={first}
                      width={widthOf(device)}
                      maxHeight={260}
                      lazy
                      contentVersion={moduleSourceOf(sources, first)}
                      title={`${component.name}, as first used`}
                      onStatus={(status) =>
                        status === "no-answer" && setNoAnswer(true)
                      }
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 px-4 text-xs text-center text-fg-tertiary">
                      Not used in any content yet
                    </div>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                  <span className="font-medium truncate text-fg-primary">
                    {component.name}
                  </span>
                  <span className="text-xs shrink-0 text-fg-tertiary">
                    {component.instances.length}{" "}
                    {component.instances.length === 1 ? "use" : "uses"}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The site did not answer on its preview route: say what it needs. */
function NoPreviewRoute() {
  return (
    <div
      role="status"
      className="px-3 py-2 mx-4 mt-3 text-sm border rounded-md border-border-primary bg-bg-secondary text-fg-secondary"
    >
      The site did not answer on <code>{VAL_COMPONENT_PREVIEW_ROUTE}</code>, so
      its components cannot be shown. Add the preview route to the app (see{" "}
      <a
        className="underline"
        href="https://github.com/valbuild/val/blob/main/packages/tanstack/README.md"
        target="_blank"
        rel="noreferrer"
      >
        the README
      </a>
      ), then reload this page.
    </div>
  );
}

type InspectorTab = "content" | "assistant";

/** One component: an instance at a time or all of them, with its fields and the assistant. */
function ComponentDetail({
  component,
  components,
  schemas,
  sources,
  state,
  update,
}: {
  component: StudioComponent;
  components: StudioComponent[];
  schemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Record<ModuleFilePath, Json>;
  state: ComponentsUrlState;
  update: (next: Partial<ComponentsUrlState>) => void;
}) {
  const count = component.instances.length;
  const index =
    count === 0 ? 0 : Math.min(Math.max(state.instance, 0), count - 1);
  const instance: SourcePath | undefined = component.instances[index];
  const example =
    state.example && component.hasExample && instance !== undefined;
  const [reloadKey, setReloadKey] = useState(0);
  const [picking, setPicking] = useState(true);
  const [tab, setTab] = useState<InspectorTab>("content");
  const [noAnswer, setNoAnswer] = useState(false);
  const onStatus = useCallback((status: ComponentFrameStatus) => {
    setNoAnswer(status === "no-answer");
  }, []);

  const descriptions = useDescriptions(component.instances);
  const labelOf = useCallback(
    (path: SourcePath) => {
      const described = descriptions.describe(path);
      const title =
        described.origin.title === "preview"
          ? described.title
          : (contentLabelOf(sourceAt(sources, path)) ?? described.title);
      const route = pageRouteOf(path, schemas);
      const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
      return { title, where: route ?? moduleFilePath };
    },
    [descriptions, sources, schemas],
  );

  const step = useCallback(
    (by: number) => {
      if (count === 0) return;
      update({ instance: (index + by + count) % count, example: false });
    },
    [count, index, update],
  );
  const componentIndex = components.findIndex((c) => c.id === component.id);
  const stepComponent = useCallback(
    (by: number) => {
      const next =
        components[
          (componentIndex + by + components.length) % components.length
        ];
      update({ component: next.id, instance: 0, example: false });
    },
    [components, componentIndex, update],
  );

  // ← → between instances, [ ] between components, while nothing is being typed in
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.composedPath()[0];
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "[") stepComponent(-1);
      else if (event.key === "]") stepComponent(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, stepComponent]);

  const onPick = useCallback((paths: SourcePath[]) => {
    const picked = paths[0];
    if (picked === undefined) return;
    setTab("content");
    scrollToStudioPath(picked);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setWide(element.getBoundingClientRect().width >= 960);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const shownLabel = instance === undefined ? null : labelOf(instance);
  const stage = (
    <div className="flex flex-col min-w-0 gap-3">
      {noAnswer && <NoPreviewRoute />}
      {instance === undefined ? (
        <div className="p-6 text-sm border border-dashed rounded-lg border-border-primary text-fg-secondary">
          No content uses {component.name} yet, so there is nothing to render it
          with: a preview finds its component through the content. Add it to a
          page, and it shows up here.
        </div>
      ) : state.layout === "all" ? (
        <ul
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${state.device === "mobile" ? 220 : 320}px, 1fr))`,
          }}
          data-testid="component-instances"
        >
          {component.instances.map((path, at) => {
            const label = labelOf(path);
            return (
              <li key={path}>
                <button
                  type="button"
                  onClick={() =>
                    update({ instance: at, layout: "one", example: false })
                  }
                  className={cn(
                    "flex flex-col w-full overflow-hidden text-left border rounded-lg bg-bg-primary hover:border-border-secondary",
                    at === index
                      ? "border-fg-secondary"
                      : "border-border-primary",
                  )}
                >
                  <div className="w-full border-b border-border-primary bg-bg-secondary">
                    <ComponentFrame
                      path={path}
                      width={widthOf(state.device)}
                      maxHeight={320}
                      lazy
                      reloadKey={reloadKey}
                      contentVersion={moduleSourceOf(sources, path)}
                      title={`${component.name}: ${label.title}`}
                      onStatus={onStatus}
                    />
                  </div>
                  <div className="px-3 py-2 min-w-0">
                    <div className="text-sm truncate text-fg-primary">
                      {label.title}
                    </div>
                    <div className="text-xs truncate text-fg-tertiary">
                      {label.where}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous use"
              title="Previous use (←)"
              disabled={count < 2}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span
              className="text-sm tabular-nums text-fg-secondary"
              data-testid="component-instance-position"
            >
              {example ? "Example" : `${index + 1} of ${count}`}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next use"
              title="Next use (→)"
              disabled={count < 2}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} />
            </Button>
            <select
              aria-label="Use"
              className="h-8 min-w-0 px-2 text-sm border rounded-md max-w-[24rem] flex-1 bg-bg-primary border-border-primary text-fg-primary"
              value={example ? "example" : String(index)}
              onChange={(event) =>
                event.target.value === "example"
                  ? update({ example: true })
                  : update({
                      instance: Number(event.target.value),
                      example: false,
                    })
              }
            >
              {component.instances.map((path, at) => {
                const label = labelOf(path);
                return (
                  <option key={path} value={String(at)}>
                    {at + 1}. {label.title} — {label.where}
                  </option>
                );
              })}
              {component.hasExample && (
                <option value="example">Example (not on the site)</option>
              )}
            </select>
          </div>
          <div className="overflow-hidden border rounded-lg border-border-primary bg-bg-secondary">
            <div
              className="mx-auto"
              style={{ maxWidth: widthOf(state.device) }}
            >
              <ComponentFrame
                path={instance}
                example={example}
                width={widthOf(state.device)}
                picking={picking && !example}
                onPick={onPick}
                reloadKey={reloadKey}
                contentVersion={moduleSourceOf(sources, instance)}
                title={`${component.name}: ${example ? "example" : (shownLabel?.title ?? "")}`}
                onStatus={onStatus}
              />
            </div>
          </div>
          {shownLabel !== null && !example && (
            <p className="text-xs text-fg-tertiary">
              {shownLabel.title} · {shownLabel.where}
            </p>
          )}
        </div>
      )}
    </div>
  );

  const inspector = (
    <aside
      className={cn(
        "flex flex-col min-w-0 border rounded-lg border-border-primary bg-bg-primary",
        wide && "sticky top-16 max-h-[calc(100vh-6rem)]",
      )}
    >
      <div
        role="tablist"
        className="flex gap-1 p-1 border-b border-border-primary"
      >
        <InspectorTabButton
          selected={tab === "content"}
          onClick={() => setTab("content")}
        >
          Content
        </InspectorTabButton>
        <InspectorTabButton
          selected={tab === "assistant"}
          onClick={() => setTab("assistant")}
        >
          <Sparkles size={14} />
          Assistant
        </InspectorTabButton>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {tab === "content" ? (
          instance === undefined || example ? (
            <p className="p-4 text-sm text-fg-secondary">
              {example
                ? "The example is written in the code, next to .component(...), and is not content an editor can change."
                : "Nothing to edit: no content uses this component yet."}
            </p>
          ) : (
            <div className="p-2" key={instance}>
              <Module path={instance} showModuleGalleryChild={null} />
            </div>
          )
        ) : (
          <ComponentAssistant
            component={component}
            shown={instance === undefined ? null : { path: instance, example }}
          />
        )}
      </div>
    </aside>
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-full"
      data-testid="component-detail"
    >
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-bg-primary border-border-primary">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => update({ component: null })}
          title="All components"
        >
          <ArrowLeft size={14} />
          <span className="ml-1">All</span>
        </Button>
        <select
          aria-label="Component"
          title="Component ([ and ])"
          className="h-8 px-2 text-sm font-medium border rounded-md bg-bg-primary border-border-primary text-fg-primary"
          value={component.id}
          onChange={(event) =>
            update({
              component: event.target.value,
              instance: 0,
              example: false,
            })
          }
        >
          {components.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.instances.length})
            </option>
          ))}
        </select>
        <div
          role="radiogroup"
          aria-label="Show"
          className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border-primary"
        >
          <LayoutButton
            selected={state.layout === "one"}
            onClick={() => update({ layout: "one" })}
            label="One at a time"
          >
            <Square size={14} />
          </LayoutButton>
          <LayoutButton
            selected={state.layout === "all"}
            onClick={() => update({ layout: "all" })}
            label="Every use side by side"
          >
            <LayoutGrid size={14} />
          </LayoutButton>
        </div>
        <DeviceSwitch
          device={state.device}
          onDevice={(device) => update({ device })}
        />
        <div className="flex items-center gap-1 ml-auto">
          {component.hasExample && instance !== undefined && (
            <ToolbarToggle
              pressed={example}
              label={
                example
                  ? "Showing the example. Show the content instead"
                  : "Show the example: content written in the code, not on the site"
              }
              onClick={() => update({ example: !example, layout: "one" })}
            >
              <FlaskConical size={14} />
              Example
            </ToolbarToggle>
          )}
          {state.layout === "one" && (
            <ToolbarToggle
              pressed={picking}
              label={
                picking
                  ? "Clicking content opens its field. Turn off to use the component as on the site"
                  : "Click content to open its field"
              }
              onClick={() => setPicking((current) => !current)}
            >
              <MousePointerClick size={14} />
            </ToolbarToggle>
          )}
          <ToolbarToggle
            label="Load the component again (after its code changed)"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            <RotateCw size={14} />
          </ToolbarToggle>
        </div>
      </header>
      <div
        className={cn(
          "grid gap-4 p-4",
          wide ? "grid-cols-[minmax(0,1fr)_22rem] items-start" : "grid-cols-1",
        )}
      >
        {stage}
        {inspector}
      </div>
    </div>
  );
}

function InspectorTabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 h-7 px-3 rounded text-sm transition-colors",
        selected
          ? "bg-bg-secondary text-fg-primary"
          : "text-fg-tertiary hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function LayoutButton({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center h-7 w-8 rounded transition-colors",
        selected
          ? "bg-bg-secondary text-fg-primary"
          : "text-fg-tertiary hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarToggle({
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
        pressed
          ? "bg-bg-secondary text-fg-primary"
          : "text-fg-tertiary hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Asking the assistant to work on the component: a request of one's own, or
 * one of a few common ones, sent with what it needs to find the component -
 * see `componentAssistantPrompt`. The conversation itself is the assistant's
 * pane, which opens beside the view.
 */
function ComponentAssistant({
  component,
  shown,
}: {
  component: StudioComponent;
  shown: { path: SourcePath; example: boolean } | null;
}) {
  const { isAIChatEnabled, askAssistant } = useAIChatActions();
  const [request, setRequest] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const ask = useCallback(
    (text: string) => {
      if (text.trim().length === 0) return;
      askAssistant(
        componentAssistantPrompt({ component, shown, request: text }),
      );
      setSent(text.trim());
      setRequest("");
    },
    [askAssistant, component, shown],
  );
  if (!isAIChatEnabled) {
    return (
      <p className="p-4 text-sm text-fg-secondary">
        The assistant is not switched on for this project. Once it is, it can
        change {component.name} from here: it is told which component this is,
        where its code is, and every place it is used.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-xs text-fg-tertiary">
        The assistant is told which component this is, where it is linked and
        every place it is used
        {shown ? ", and which one you are looking at" : ""}.
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          ask(request);
        }}
      >
        <textarea
          aria-label={`Ask the assistant about ${component.name}`}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              ask(request);
            }
          }}
          rows={4}
          placeholder={`What should change in ${component.name}?`}
          className="w-full p-2 text-sm border rounded-md resize-y bg-bg-primary border-border-primary text-fg-primary placeholder:text-fg-tertiary"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-tertiary">⌘/Ctrl + Enter</span>
          <Button size="xs" type="submit" disabled={request.trim() === ""}>
            <Send size={14} />
            <span className="ml-1">Ask</span>
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {COMPONENT_REQUESTS.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => ask(option.request)}
            title={option.request}
            className="px-2 py-1 text-xs border rounded-full border-border-primary text-fg-secondary hover:text-fg-primary hover:border-border-secondary"
          >
            {option.label}
          </button>
        ))}
      </div>
      {sent !== null && (
        <p role="status" className="text-xs text-fg-secondary">
          Sent to the assistant: “
          {sent.length > 60 ? sent.slice(0, 59) + "…" : sent}”
        </p>
      )}
      <div className="pt-2 border-t border-border-primary">
        <div className="mb-1 text-xs font-medium text-fg-secondary">
          Linked in
        </div>
        <ul className="flex flex-col gap-0.5 text-xs text-fg-tertiary">
          {component.linkedAt.map((link) => (
            <li key={`${link.moduleFilePath}:${link.at}`} className="truncate">
              <code>{link.moduleFilePath}</code>
              {link.at ? ` · ${link.at}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
