import {
  Internal,
  type Json,
  type JsonArray,
  type JsonObject,
  type ModuleFilePath,
  prettyExampleName,
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
  RotateCw,
  Search,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { cn } from "../designSystem/cn";
import { Button } from "../designSystem/button";
import { Spinner } from "../designSystem/spinner";
import {
  useAllSources,
  useSchemaAtPath,
  useSchemas,
} from "../ValFieldProvider";
import { AnyField } from "../AnyField";
import { scrollToStudioPath } from "../ValRouter";
import { useDescriptions } from "../useDescriptions";
import { useValSystem } from "../../stores/react/SystemContext";
import { useAllJsonValuesLoad } from "../useJsonValuesLoad";
import {
  collectComponents,
  componentPages,
  componentSearchHits,
  deepestUseAt,
  type ComponentPage,
  type ComponentUse,
  type ComponentSearchHit,
  type StudioComponent,
} from "../../utils/collectComponents";
import {
  contentLabelOf,
  pageRouteOf,
  VAL_COMPONENT_PREVIEW_ROUTE,
} from "../../utils/componentReview";
import {
  ComponentFrame,
  type ComponentFrameInline,
  type ComponentFrameStatus,
} from "./ComponentFrame";
import { useComponentsCode } from "./componentsCode";
import { SelectButton } from "../shell/SelectButton";
import { CanvasDeviceButtons } from "../shell/canvas/CanvasToolbar";
import { CANVAS_GROUND } from "../shell/canvas/CanvasWindow";
import { CANVAS_DEVICE_WIDTHS } from "../shell/canvas/types";
import {
  useSelectModePreference,
  type CanvasSelectMode,
} from "../../hooks/selectModePreference";
import {
  getComponentsUrlState,
  subscribeComponentsUrlState,
  updateComponentsUrlState,
  type ComponentsUrlState,
  type Device,
} from "./componentsUrlState";

type ComponentsViewData =
  | { status: "loading" }
  | {
      status: "ready";
      schemas: Record<ModuleFilePath, SerializedSchema>;
      sources: Record<ModuleFilePath, Json>;
      components: StudioComponent[];
      pages: ComponentPage[];
      state: ComponentsUrlState;
      update: (next: Partial<ComponentsUrlState>) => void;
      /** The component open, or `null` on the board. */
      selected: StudioComponent | null;
    };

/**
 * What both halves of the view read: the components, and which one (and
 * which use of it) is on screen - one state, in the address.
 */
function useComponentsView(): ComponentsViewData {
  const schemasRes = useSchemas();
  const sources = useAllSources();
  const schemas = schemasRes.status === "success" ? schemasRes.data : null;
  const components = useMemo(
    () => (schemas === null ? null : collectComponents(schemas, sources)),
    [schemas, sources],
  );
  const pages = useMemo(
    () =>
      schemas === null || components === null
        ? null
        : componentPages(schemas, sources, components),
    [schemas, sources, components],
  );
  const state = useSyncExternalStore(
    subscribeComponentsUrlState,
    getComponentsUrlState,
    getComponentsUrlState,
  );
  if (components === null || schemas === null || pages === null) {
    return { status: "loading" };
  }
  const selected =
    state.component === null
      ? null
      : (components.find((component) => component.id === state.component) ??
        null);
  return {
    status: "ready",
    schemas,
    sources,
    components,
    pages,
    state,
    update: updateComponentsUrlState,
    selected,
  };
}

/**
 * EXPERIMENTAL: the Studio's Components view, at `/val/components` - the half
 * in the PREVIEW's place.
 *
 * Every component the project links to an object
 * (`s.object(...).component(() => import(...))`), rendered by the site
 * itself on its preview route, and every place the content uses each one.
 *
 * - **The board**: all of them side by side, each as it first appears in the
 *   content, at one screen width.
 * - **One component**: stepped through use by use (← and →), or all its uses
 *   side by side, and its examples after its uses.
 * - **Pages**: each page with the components it uses, stacked as its content
 *   has them.
 *
 * It is laid out like a page is: this is where the preview would be, and
 * Content (the fields of the use on screen: {@link ComponentsContent}) and
 * the Assistant come from the top bar beside it.
 */
export function ComponentsStage() {
  const view = useComponentsView();
  if (view.status === "loading") {
    return (
      <div className="flex items-center justify-center h-full p-8 text-fg-secondary">
        <Spinner />
      </div>
    );
  }
  if (view.components.length === 0) {
    return <NoComponents />;
  }
  if (view.state.mode === "pages") {
    return <PagesStage view={view} />;
  }
  if (view.selected === null) {
    return (
      <Board
        components={view.components}
        sources={view.sources}
        device={view.state.device}
        onDevice={(device) => view.update({ device })}
        onOpen={(component) =>
          view.update({ component: component.id, instance: 0, example: null })
        }
        missing={view.state.component !== null}
      />
    );
  }
  return (
    <ComponentDetail
      key={view.selected.id}
      component={view.selected}
      components={view.components}
      schemas={view.schemas}
      sources={view.sources}
      state={view.state}
      update={view.update}
    />
  );
}

/**
 * EXPERIMENTAL: the Components view's half in the CONTENT pane: on the board,
 * the list of components; with one open, the fields of the use on screen, so
 * an edit is made beside where its effect is seen.
 */
export function ComponentsContent() {
  const view = useComponentsView();
  if (view.status === "loading") {
    return (
      <div className="flex items-center justify-center p-8 text-fg-secondary">
        <Spinner />
      </div>
    );
  }
  if (view.state.mode === "pages") {
    return <PagesContent view={view} />;
  }
  if (view.selected === null) {
    return (
      <ComponentsIndex
        components={view.components}
        onOpen={(component) =>
          view.update({ component: component.id, instance: 0, example: null })
        }
      />
    );
  }
  const component = view.selected;
  const count = component.instances.length;
  const index =
    count === 0 ? 0 : Math.min(Math.max(view.state.instance, 0), count - 1);
  const instance = component.instances[index];
  const example = shownExample(component, view.state, instance);
  return (
    <div className="flex flex-col gap-4" data-testid="component-fields">
      <div>
        <button
          type="button"
          onClick={() => view.update({ component: null })}
          className="flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ChevronLeft size={14} />
          All components
        </button>
        <h1 className="mt-2 text-2xl font-medium text-fg-primary">
          {component.name}
        </h1>
        <p className="text-sm text-fg-tertiary">
          {example !== null
            ? `Example: ${prettyExampleName(example)}`
            : count === 0
              ? "Not used yet"
              : `Use ${index + 1} of ${count}`}
        </p>
      </div>
      {example !== null ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-fg-secondary">
            Examples are written in the code, next to .component(...), to show
            how the component looks with content that is not on the site. They
            are not content an editor can change.
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => view.update({ example: null })}
          >
            Show the content instead
          </Button>
        </div>
      ) : instance === undefined ? (
        <p className="text-sm text-fg-secondary">
          Nothing to edit: no content uses this component yet.
        </p>
      ) : (
        <InstanceFields key={instance} path={instance} />
      )}
    </div>
  );
}

/**
 * The fields of one use, without the heading the editor gives a page it has
 * navigated to: the heading above them names the component and which use
 * this is, which is what this view is about.
 */
function InstanceFields({ path }: { path: SourcePath }) {
  const schemaRes = useSchemaAtPath(path);
  if (schemaRes.status !== "success") {
    return (
      <div className="flex items-center justify-center p-6 text-fg-secondary">
        <Spinner />
      </div>
    );
  }
  return <AnyField path={path} schema={schemaRes.data} ignoreHidden />;
}

/** The Content pane on the board: every component, by name, to open one. */
function ComponentsIndex({
  components,
  onOpen,
}: {
  components: StudioComponent[];
  onOpen: (component: StudioComponent) => void;
}) {
  if (components.length === 0) {
    return (
      <p className="text-sm text-fg-secondary">
        No components are linked to this project&apos;s content yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="components-index">
      <div>
        <h1 className="text-2xl font-medium text-fg-primary">Components</h1>
        <p className="text-sm text-fg-tertiary">
          Open one to go through every place it is used.
        </p>
      </div>
      <ul className="flex flex-col">
        {components.map((component) => (
          <li key={component.id}>
            <button
              type="button"
              onClick={() => onOpen(component)}
              className="flex items-center justify-between w-full gap-3 px-2 py-2 text-left rounded-md hover:bg-bg-secondary"
            >
              <span className="min-w-0">
                <span className="block truncate text-fg-primary">
                  {component.name}
                </span>
                <span className="block text-xs truncate text-fg-tertiary">
                  {component.linkedAt[0]?.moduleFilePath ?? ""}
                </span>
              </span>
              <span className="text-xs shrink-0 text-fg-tertiary">
                {component.instances.length}{" "}
                {component.instances.length === 1 ? "use" : "uses"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
    examples: { longTitle: { type: "hero", title: "A long title" } },
  });`}
      </pre>
      <p>
        Components render in the Studio through the site&apos;s own{" "}
        <code>{VAL_COMPONENT_PREVIEW_ROUTE}</code> route.
      </p>
    </div>
  );
}

/** The canvas's own screen buttons (`CanvasDeviceButtons`), in a group like its toolbar's. */
function DeviceSwitch({
  device,
  onDevice,
}: {
  device: Device;
  onDevice: (device: Device) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Screen"
      className="inline-flex items-center gap-0.5 p-0.5 border rounded-lg border-border-float bg-bg-float"
    >
      <CanvasDeviceButtons device={device} onDeviceChange={onDevice} />
    </div>
  );
}

/** How narrow a card on a board may get: wider for a wider screen, so a thumbnail stays legible. */
function cardMinWidth(device: Device): number {
  return device === "mobile" ? 220 : device === "tablet" ? 320 : 440;
}

function widthOf(device: Device): number {
  return CANVAS_DEVICE_WIDTHS[device];
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
    <StageLayout testId="components-board">
      <StageHeader>
        <div className="flex items-center gap-2">
          <ModeSwitch mode="components" />
          <span className="text-sm text-fg-tertiary">
            {components.length}{" "}
            {components.length === 1 ? "component" : "components"} · {uses}{" "}
            {uses === 1 ? "use" : "uses"}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <ComponentSearch components={components} />
          <DeviceSwitch device={device} onDevice={onDevice} />
        </div>
      </StageHeader>
      <StagePanel>
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
            gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth(device)}px, 1fr))`,
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
      </StagePanel>
    </StageLayout>
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

/** One component: a use, or an example, at a time, or all of them side by side. */
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
  const example = shownExample(component, state, instance);
  const [reloadKey, setReloadKey] = useState(0);
  const select = useStageSelect();
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

  /*
   * ← and → go through everything there is to look at: the uses, then the
   * examples - which render through a use, so there are none without one.
   */
  const total = count === 0 ? 0 : count + component.examples.length;
  const position =
    example !== null ? count + component.examples.indexOf(example) : index;
  const step = useCallback(
    (by: number) => {
      if (total === 0) return;
      const next = (position + by + total) % total;
      if (next < count) {
        update({ instance: next, example: null });
      } else {
        update({ example: component.examples[next - count] });
      }
    },
    [total, position, count, component.examples, update],
  );
  const componentIndex = components.findIndex((c) => c.id === component.id);
  const stepComponent = useCallback(
    (by: number) => {
      const next =
        components[
          (componentIndex + by + components.length) % components.length
        ];
      update({ component: next.id, instance: 0, example: null });
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
            gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth(state.device)}px, 1fr))`,
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
                    update({ instance: at, layout: "one", example: null })
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
          {component.examples.map((name) => (
            <li key={`example:${name}`}>
              <button
                type="button"
                onClick={() => update({ example: name, layout: "one" })}
                className="flex flex-col w-full overflow-hidden text-left border border-dashed rounded-lg bg-bg-primary hover:border-border-secondary border-border-primary"
              >
                <div className="w-full border-b border-border-primary bg-bg-secondary">
                  <ComponentFrame
                    path={component.instances[0]}
                    example={name}
                    width={widthOf(state.device)}
                    maxHeight={320}
                    lazy
                    reloadKey={reloadKey}
                    title={`${component.name}: ${prettyExampleName(name)}`}
                    onStatus={onStatus}
                  />
                </div>
                <div className="flex items-center min-w-0 gap-1.5 px-3 py-2">
                  <FlaskConical
                    size={12}
                    className="shrink-0 text-fg-tertiary"
                  />
                  <span className="text-sm truncate text-fg-primary">
                    {prettyExampleName(name)}
                  </span>
                  <span className="text-xs shrink-0 text-fg-tertiary">
                    Example
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous use"
              title="Previous use (←)"
              disabled={total < 2}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span
              className="text-sm tabular-nums text-fg-secondary"
              data-testid="component-instance-position"
            >
              {example !== null
                ? `Example ${component.examples.indexOf(example) + 1} of ${component.examples.length}`
                : `${index + 1} of ${count}`}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next use"
              title="Next use (→)"
              disabled={total < 2}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} />
            </Button>
            <select
              aria-label="Use"
              className="h-8 min-w-0 px-2 text-sm border rounded-md max-w-[24rem] flex-1 bg-bg-primary border-border-primary text-fg-primary"
              value={example !== null ? `example:${example}` : String(index)}
              onChange={(event) =>
                event.target.value.startsWith("example:")
                  ? update({
                      example: event.target.value.slice("example:".length),
                    })
                  : update({
                      instance: Number(event.target.value),
                      example: null,
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
              {component.examples.length > 0 && (
                <optgroup label="Examples (not on the site)">
                  {component.examples.map((name) => (
                    <option key={name} value={`example:${name}`}>
                      {prettyExampleName(name)}
                    </option>
                  ))}
                </optgroup>
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
                picking={select.picking && example === null}
                onPick={(paths) => select.onPick(instance, paths)}
                inline={example !== null ? null : select.inlineFor(instance)}
                reloadKey={reloadKey}
                contentVersion={moduleSourceOf(sources, instance)}
                title={`${component.name}: ${example !== null ? prettyExampleName(example) : (shownLabel?.title ?? "")}`}
                onStatus={onStatus}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <StageLayout testId="component-detail">
      <StageHeader>
        <ModeSwitch mode="components" />
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
              example: null,
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
          <ComponentSearch components={components} />
          {component.examples.length > 0 && instance !== undefined && (
            <ToolbarToggle
              pressed={example !== null}
              label={
                example !== null
                  ? "Showing an example. Show the content instead"
                  : "Show the examples: content written in the code, not on the site"
              }
              onClick={() =>
                update({
                  example: example !== null ? null : component.examples[0],
                  layout: "one",
                })
              }
            >
              <FlaskConical size={14} />
              {component.examples.length === 1
                ? "Example"
                : `Examples (${component.examples.length})`}
            </ToolbarToggle>
          )}
          {state.layout === "one" && <StageSelectButton select={select} />}
          <ToolbarToggle
            label="Load the component again (after its code changed)"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            <RotateCw size={14} />
          </ToolbarToggle>
        </div>
      </StageHeader>
      <StagePanel>
        <div className="flex flex-col gap-3 p-4">{stage}</div>
      </StagePanel>
    </StageLayout>
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
 * Search the content of the components: the Studio's own search (the same
 * engine and index as everywhere else), with each hit given to the use of a
 * component it is in (`componentSearchHits`), and opening that use.
 */
function ComponentSearch({ components }: { components: StudioComponent[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { hits, isSearching } = useComponentSearch(query, components);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && !event.composedPath().includes(container)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  const pick = (hit: ComponentSearchHit) => {
    updateComponentsUrlState({
      component: hit.component.id,
      instance: hit.instance,
      example: null,
      layout: "one",
    });
    setOpen(false);
  };
  const trimmed = query.trim();
  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center h-8 gap-1.5 px-2 border rounded-md w-44 focus-within:w-56 transition-[width] border-border-primary bg-bg-primary focus-within:border-border-secondary">
        <Search size={14} className="shrink-0 text-fg-tertiary" />
        <input
          type="search"
          aria-label="Search the content of the components"
          placeholder="Search in components"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && hits[0] !== undefined) pick(hits[0]);
          }}
          className="flex-1 min-w-0 text-sm bg-transparent outline-none text-fg-primary placeholder:text-fg-tertiary"
        />
        {isSearching && <Spinner size={12} />}
      </div>
      {open && trimmed !== "" && (
        <div
          role="listbox"
          aria-label="Components found"
          data-testid="component-search-results"
          className="absolute right-0 z-50 mt-1 overflow-y-auto border rounded-lg shadow-lg w-80 max-h-96 border-border-primary bg-bg-primary"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-fg-tertiary">
              {isSearching
                ? "Searching…"
                : `No component's content matches “${trimmed}”.`}
            </p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.path}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(hit)}
                className="flex flex-col w-full px-3 py-2 text-left hover:bg-bg-secondary"
              >
                <span className="text-sm truncate text-fg-primary">
                  {hit.label}
                </span>
                <span className="text-xs truncate text-fg-tertiary">
                  {hit.component.name} · use {hit.instance + 1} of{" "}
                  {hit.component.instances.length}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** How many hits are asked of the search, before they are narrowed to components. */
const SEARCH_LIMIT = 200;

function useComponentSearch(
  query: string,
  components: StudioComponent[],
): { hits: ComponentSearchHit[]; isSearching: boolean } {
  const val = useValSystem();
  const trimmed = query.trim();
  // `.jsonValues()` entries are searched once they are here
  useAllJsonValuesLoad(trimmed !== "");
  const [found, setFound] = useState<{ path: SourcePath; label: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  useEffect(() => {
    if (val === null || trimmed === "") {
      setFound([]);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    void val.system
      .search(trimmed, SEARCH_LIMIT)
      .then((res) => {
        if (!cancelled) setFound(res.status === "no-index" ? [] : res.results);
      })
      .catch(() => {
        if (!cancelled) setFound([]);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      // A slow answer for "a" must not overwrite the answer for "abc"
      cancelled = true;
    };
  }, [val, trimmed]);
  const hits = useMemo(
    () => componentSearchHits(found, components),
    [found, components],
  );
  return { hits, isSearching };
}

type ReadyView = Extract<ComponentsViewData, { status: "ready" }>;

/** Components, or Pages: what the view lists. Opening the other keeps the screen width. */
function ModeSwitch({ mode }: { mode: ComponentsUrlState["mode"] }) {
  const options: { mode: ComponentsUrlState["mode"]; label: string }[] = [
    { mode: "components", label: "Components" },
    { mode: "pages", label: "Pages" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="List"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border-primary"
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={mode === option.mode}
          onClick={() =>
            mode !== option.mode &&
            updateComponentsUrlState({
              mode: option.mode,
              page: null,
              block: null,
            })
          }
          className={cn(
            "h-7 px-2.5 rounded text-sm transition-colors",
            mode === option.mode
              ? "bg-bg-secondary text-fg-primary font-medium"
              : "text-fg-tertiary hover:text-fg-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type StageSelect = {
  picking: boolean;
  setPicking: (picking: boolean) => void;
  mode: CanvasSelectMode;
  setMode: (mode: CanvasSelectMode) => void;
  /** A pick in the frame `frame` (its path): what Select does with it. */
  onPick: (frame: string, paths: SourcePath[]) => void;
  /** Typing in place, for the frame `frame`: `null` while Select & edit is not in use. */
  inlineFor: (frame: string) => ComponentFrameInline | null;
};

/**
 * The stage's Select: Content's Select from beside a page's preview - the
 * same button, and the same state, handed down by the shell
 * (`ComponentsCode.select`), so switching its mode here switches it there.
 *
 * - **Select** opens the picked field in the Content pane: scrolled to.
 * - **Select & edit** puts the caret in a picked text where the component
 *   shows it - the canvas's own editing on the page (`useCanvasInlineEdit`,
 *   the shell's one), answered in the frame by the preview route's bridge -
 *   and opens anything else in Content, as the canvas does.
 */
function useStageSelect(onPicked?: (path: SourcePath) => void): StageSelect {
  const code = useComponentsCode();
  const [picking, setPicking] = useState(true);
  // Only where no shell hands one down: a story, a test
  const [ownMode, setOwnMode] = useSelectModePreference();
  const mode = code.select?.mode ?? ownMode;
  const setMode = code.select?.onModeChange ?? setOwnMode;
  const edit = code.inlineEdit ?? null;
  const [inlineFrame, setInlineFrame] = useState<string | null>(null);
  const onPickedRef = useRef(onPicked);
  onPickedRef.current = onPicked;
  const open = useCallback((paths: SourcePath[]) => {
    const picked = paths[0];
    if (picked === undefined) return;
    scrollToStudioPath(picked);
  }, []);
  const onPick = useCallback(
    (frame: string, paths: SourcePath[]) => {
      const picked = paths[0];
      if (picked === undefined) return;
      onPickedRef.current?.(picked);
      if (mode === "edit" && edit !== null && edit.offer(paths)) {
        setInlineFrame(frame);
        return;
      }
      open(paths);
    },
    [mode, edit, open],
  );
  const inlineFor = useCallback(
    (frame: string): ComponentFrameInline | null =>
      edit === null || mode !== "edit"
        ? null
        : {
            edit,
            request: inlineFrame === frame ? edit.request : null,
            onFallback: open,
          },
    [edit, mode, inlineFrame, open],
  );
  return { picking, setPicking, mode, setMode, onPick, inlineFor };
}

function StageSelectButton({ select }: { select: StageSelect }) {
  return (
    <SelectButton
      selectFor="content"
      pressed={select.picking}
      onPressedChange={select.setPicking}
      mode={select.mode}
      onModeChange={select.setMode}
    />
  );
}

/** The Pages mode in the preview's place: the pages, or one page's components stacked. */
function PagesStage({ view }: { view: ReadyView }) {
  const { pages, state, update, sources } = view;
  const page = pages.find((candidate) => candidate.key === state.page) ?? null;
  const select = useStageSelect((picked) => {
    if (page === null) return;
    const use = deepestUseAt(page.uses, picked);
    if (use !== null && use.path !== state.block) update({ block: use.path });
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [noAnswer, setNoAnswer] = useState(false);
  const onStatus = useCallback((status: ComponentFrameStatus) => {
    if (status === "no-answer") setNoAnswer(true);
  }, []);
  return (
    <StageLayout testId="component-pages">
      <StageHeader>
        <ModeSwitch mode="pages" />
        {page !== null && (
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => update({ page: null, block: null })}
              title="All pages"
            >
              <ArrowLeft size={14} />
              <span className="ml-1">All</span>
            </Button>
            <select
              aria-label="Page"
              className="h-8 px-2 text-sm font-medium border rounded-md bg-bg-primary border-border-primary text-fg-primary"
              value={page.key}
              onChange={(event) =>
                update({ page: event.target.value, block: null })
              }
            >
              {pages.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </>
        )}
        <DeviceSwitch
          device={state.device}
          onDevice={(device) => update({ device })}
        />
        <div className="flex items-center gap-1 ml-auto">
          {page !== null && <StageSelectButton select={select} />}
          <ToolbarToggle
            label="Load the components again (after their code changed)"
            onClick={() => setReloadKey((current) => current + 1)}
          >
            <RotateCw size={14} />
          </ToolbarToggle>
        </div>
      </StageHeader>
      <StagePanel>
        {noAnswer && <NoPreviewRoute />}
        {page === null ? (
          <ul
            className="flex flex-col gap-2 p-4"
            data-testid="component-pages-list"
          >
            {pages.map((option) => (
              <li key={option.key}>
                <button
                  type="button"
                  onClick={() => update({ page: option.key, block: null })}
                  className="flex flex-col w-full gap-2 px-4 py-3 text-left border rounded-lg border-border-primary bg-bg-primary hover:border-border-secondary"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-fg-primary">
                      {option.label}
                    </span>
                    <span className="text-xs text-fg-tertiary">
                      {option.count}{" "}
                      {option.count === 1 ? "component" : "components"}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {option.uses.map((use) => (
                      <span
                        key={use.path}
                        className="px-2 py-0.5 text-xs rounded-full bg-bg-secondary text-fg-secondary"
                      >
                        {use.component.name}
                        {use.children.length > 0
                          ? ` + ${countUses(use.children)}`
                          : ""}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {page.uses.map((use) => (
              <UseBlock
                key={use.path}
                use={use}
                view={view}
                sources={sources}
                select={select}
                reloadKey={reloadKey}
                onStatus={onStatus}
              />
            ))}
          </div>
        )}
      </StagePanel>
    </StageLayout>
  );
}

function countUses(uses: readonly ComponentUse[]): number {
  return uses.reduce((sum, use) => sum + 1 + countUses(use.children), 0);
}

/**
 * One use on a page: its component rendered, and the uses inside it stacked
 * under it, one above the other, as the content has them.
 */
function UseBlock({
  use,
  view,
  sources,
  select,
  reloadKey,
  onStatus,
}: {
  use: ComponentUse;
  view: ReadyView;
  sources: Record<ModuleFilePath, Json>;
  select: StageSelect;
  reloadKey: number;
  onStatus: (status: ComponentFrameStatus) => void;
}) {
  const selected = view.state.block === use.path;
  return (
    <section
      data-testid={`component-block-${use.component.name}`}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex flex-col overflow-hidden border rounded-lg bg-bg-primary",
        selected ? "border-fg-secondary" : "border-border-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border-primary">
        <button
          type="button"
          onClick={() => view.update({ block: use.path })}
          className="flex items-baseline min-w-0 gap-2 text-left"
        >
          <span className="text-sm font-medium text-fg-primary">
            {use.component.name}
          </span>
          <span className="text-xs truncate text-fg-tertiary">
            {useLocationLabel(use.path)}
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            view.update({
              mode: "components",
              page: null,
              block: null,
              component: use.component.id,
              instance: use.instance,
              example: null,
              layout: "one",
            })
          }
          className="grid w-6 h-6 rounded shrink-0 place-items-center text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary"
          title={`Open in Components: every use of ${use.component.name}`}
          aria-label="Open in Components"
        >
          <Blocks size={13} />
        </button>
      </div>
      <div className="bg-bg-secondary">
        <div
          className="mx-auto"
          style={{ maxWidth: widthOf(view.state.device) }}
        >
          <ComponentFrame
            path={use.path}
            width={widthOf(view.state.device)}
            picking={select.picking}
            onPick={(paths) => select.onPick(use.path, paths)}
            inline={select.inlineFor(use.path)}
            reloadKey={reloadKey}
            lazy
            contentVersion={moduleSourceOf(sources, use.path)}
            title={`${use.component.name} at ${use.path}`}
            onStatus={onStatus}
          />
        </div>
      </div>
      {use.children.length > 0 && (
        <div className="flex flex-col gap-3 p-3 pl-6 border-t border-border-primary">
          <span className="text-xs text-fg-tertiary">
            Inside {use.component.name}
          </span>
          {use.children.map((child) => (
            <UseBlock
              key={child.path}
              use={child}
              view={view}
              sources={sources}
              select={select}
              reloadKey={reloadKey}
              onStatus={onStatus}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Where a use is inside its page: its last two segments, `sections[1]`, `cards[0]`. */
function useLocationLabel(path: SourcePath): string {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) return "";
  // A page's route is the page, already named above it
  const segments = Internal.splitModulePath(modulePath).filter(
    (segment) => !segment.startsWith("/"),
  );
  const out: string[] = [];
  for (const segment of segments.slice(-2)) {
    if (/^\d+$/.test(segment) && out.length > 0) {
      out[out.length - 1] += `[${segment}]`;
    } else {
      out.push(segment);
    }
  }
  return out.join(".");
}

/** The Pages mode in the Content pane: the pages, or one page's outline and the fields of the use picked. */
function PagesContent({ view }: { view: ReadyView }) {
  const { pages, state, update } = view;
  const page = pages.find((candidate) => candidate.key === state.page) ?? null;
  if (page === null) {
    return (
      <div className="flex flex-col gap-3" data-testid="component-pages-index">
        <div>
          <h1 className="text-2xl font-medium text-fg-primary">Pages</h1>
          <p className="text-sm text-fg-tertiary">
            Open one to see the components it is made of, in order.
          </p>
        </div>
        <ul className="flex flex-col">
          {pages.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                onClick={() => update({ page: option.key, block: null })}
                className="flex items-center justify-between w-full gap-3 px-2 py-2 text-left rounded-md hover:bg-bg-secondary"
              >
                <span className="truncate text-fg-primary">{option.label}</span>
                <span className="text-xs shrink-0 text-fg-tertiary">
                  {option.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // The use picked, as the page has it: only an exact match shows its fields
  const found =
    state.block === null ? null : deepestUseAt(page.uses, state.block);
  const blockUse = found !== null && found.path === state.block ? found : null;
  return (
    <div className="flex flex-col gap-4" data-testid="component-page-outline">
      <div>
        <button
          type="button"
          onClick={() => update({ page: null, block: null })}
          className="flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ChevronLeft size={14} />
          All pages
        </button>
        <h1 className="mt-2 text-2xl font-medium text-fg-primary">
          {page.label}
        </h1>
        <p className="text-sm text-fg-tertiary">
          {page.count} {page.count === 1 ? "component" : "components"} on this
          page
        </p>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium tracking-wide uppercase text-fg-tertiary">
          On this page
        </div>
        <OutlineList
          uses={page.uses}
          depth={0}
          block={state.block}
          onPick={(path) => update({ block: path })}
        />
      </div>
      {blockUse !== null && (
        <div className="pt-4 border-t border-border-primary">
          <InstanceFields key={blockUse.path} path={blockUse.path} />
        </div>
      )}
    </div>
  );
}

function OutlineList({
  uses,
  depth,
  block,
  onPick,
}: {
  uses: readonly ComponentUse[];
  depth: number;
  block: string | null;
  onPick: (path: SourcePath) => void;
}) {
  return (
    <ul className="flex flex-col">
      {uses.map((use) => (
        <li key={use.path}>
          <button
            type="button"
            onClick={() => onPick(use.path)}
            aria-current={block === use.path ? "true" : undefined}
            className={cn(
              "flex items-center w-full gap-2 py-1.5 pr-2 text-left rounded-md text-sm",
              block === use.path
                ? "bg-bg-secondary text-fg-primary"
                : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
            )}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            {use.component.name}
            <span className="text-xs text-fg-tertiary">
              {useLocationLabel(use.path)}
            </span>
          </button>
          {use.children.length > 0 && (
            <OutlineList
              uses={use.children}
              depth={depth + 1}
              block={block}
              onPick={onPick}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The stage, laid out as the preview it stands in for: its controls in a row
 * above (where the preview's address bar is), and what it shows below on the
 * canvas's own dotted ground (`CanvasWindow`), in a panel that scrolls.
 */
function StageLayout({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-2" data-testid={testId}>
      {children}
    </div>
  );
}

function StageHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center shrink-0 gap-2 min-h-8">
      {children}
    </div>
  );
}

function StagePanel({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative flex-1 min-h-0 overflow-y-auto border rounded-xl border-border-float scrollbar-slim",
        CANVAS_GROUND,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The example on screen: the one the address names, when the component has
 * it and something to render it through (a use: the preview finds the
 * component by path). `null` for a use.
 */
function shownExample(
  component: StudioComponent,
  state: ComponentsUrlState,
  instance: SourcePath | undefined,
): string | null {
  return state.example !== null &&
    instance !== undefined &&
    component.examples.includes(state.example)
    ? state.example
    : null;
}
