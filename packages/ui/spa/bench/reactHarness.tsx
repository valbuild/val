import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import { createSystem, type System } from "../stores/createSystem";

/**
 * The same measurement, with React in the loop.
 *
 * The plain benchmark drives the stores directly, which leaves the biggest
 * unknown untouched: `openquestions.md` says reconciliation "in the real Studio
 * may dominate everything measured above". It also cannot see the thing React
 * makes most visible, and which is the whole point of per-path eventing —
 * **how many components re-render when one character is typed.**
 *
 * The engine's finest source subscription is `subscribe("source", module)`.
 * That is not a limitation invented here: it is the API, and
 * `ValFieldProvider.tsx` uses exactly that, with `useSyncExternalStore` and
 * `getSourceSnapshot(module)`. So every mounted field in the edited module is
 * notified, and re-renders. This harness mirrors that pattern faithfully rather
 * than inventing a finer subscription the engine does not have.
 *
 * The stores are given the honest equivalent of the hook someone would write:
 * `getSnapshot` calls `sourceStore.peek(path)`, which is SYNCHRONOUS and returns
 * the value, so a mounting field renders once. `subscribe` registers the real
 * per-path listener; a wake re-peeks. `get` is called only when peek reports the
 * path is inside a `.jsonValues()` entry that has not been fetched, which is the
 * one case that genuinely needs a round trip.
 *
 * An earlier version of this adapter kept a per-path cache and kicked an ASYNC
 * `get` from `subscribe`, because `useSyncExternalStore` cannot call an async
 * function. It measured 32 mount renders against the engine's 16 — every field
 * rendering once with nothing and again a microtask later — and that number is
 * what made `openquestions.md` item 1 ask whether the host realm needed a
 * synchronous read. It did, and it already had one: `peek` resolved the value all
 * the way and threw it away. The rule is `peek` to render, `get` to demand.
 *
 * Both sides count renders the same way: the component bumps a shared counter in
 * its body. Both commit through `flushSync`, so "committed" is a point in time
 * rather than whenever React felt like it.
 */

/** What a field component needs, from either system. */
type FieldAdapter = {
  name: string;
  subscribe(path: SourcePath): (onChange: () => void) => () => void;
  /** Must return a STABLE reference until the value actually changes. */
  getSnapshot(path: SourcePath): unknown;
  type(module: string, path: string, value: string): Promise<void>;
  /** Wait for anything the adapter kicked off to settle. */
  settle(): Promise<void>;
  dispose(): void;
};

export type ReactSample = {
  /** Time to a committed initial mount. */
  mountMs: number;
  /** Time from issuing the keystroke to React having committed. */
  keystrokeMs: number;
  /** Component bodies run during the initial mount. */
  mountRenders: number;
  /**
   * Component bodies run for ONE keystroke. The headline: with per-module
   * notification this is every field in the edited module; with per-path
   * notification it is the one field that changed — and with per-instance
   * suppression it can be zero, because the field that caused the patch already
   * holds the value it typed.
   */
  keystrokeRenders: number;
  /** Fields mounted, so a run that rendered nothing cannot look like a win. */
  fields: number;
};

let renderCount = 0;

function Field({
  path,
  adapter,
}: {
  path: SourcePath;
  adapter: FieldAdapter;
}): JSX.Element {
  renderCount++;
  const value = useSyncExternalStore(
    adapter.subscribe(path),
    () => adapter.getSnapshot(path),
    () => adapter.getSnapshot(path),
  );
  // A DOM node per field, because a component that renders nothing is not a
  // component React has to commit.
  return <span data-path={path}>{describe(value)}</span>;
}

/**
 * Force React to commit whatever a store notification scheduled.
 *
 * NOT a `setTimeout(0)`, which an earlier version used: in a loaded container a
 * macrotask hop is several milliseconds on its own, and it landed in every
 * keystroke measurement. Both systems then read ~4.5ms and the honest conclusion
 * would have been "React dominates" — when what dominated was the harness.
 *
 * `flushSync` with an empty callback drains React's pending work synchronously,
 * so the stopwatch stops when the commit is done rather than a macrotask later.
 */
function flushPendingReact(): void {
  flushSync(() => {});
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return "ok";
}

// --------------------------------------------------------------------------
// stores adapter
// --------------------------------------------------------------------------

function storesAdapter(modules: ValModule<SelectorSource>[]): {
  adapter: FieldAdapter;
  ready: Promise<void>;
} {
  const system: System = createSystem({
    fetchPatches: async () => {
      throw new Error("The React benchmark took a network path: GET /patches.");
    },
    createPatchId: (() => {
      let next = 0;
      return () => `react-bench-${++next}` as never;
    })(),
  });
  system.host.receive(modules);

  /**
   * Last value handed to React, per path.
   *
   * Not a read cache — `peek` is the read and it is cheap. This exists only
   * because `useSyncExternalStore` requires `getSnapshot` to return a STABLE
   * reference until the value actually changes, and it would otherwise tear on
   * every call for an object-valued path.
   */
  const held = new Map<SourcePath, unknown>();
  const subscribers = new Map<
    SourcePath,
    (onChange: () => void) => () => void
  >();
  const inFlight = new Set<Promise<void>>();
  let fieldIds = 0;

  const snapshot = (path: SourcePath): unknown => {
    const seen = system.sourceStore.peek(path);
    if (seen.status === "entry-missing") {
      // The one case peek cannot answer: the path is inside a `.jsonValues()`
      // entry whose content has not been fetched. THIS is what `get` is for, and
      // it is the demand signal that starts the fetch. Kicked once — `peek` will
      // report `entry-loading` while it is in flight, so this cannot storm.
      const request = system.sourceStore.get(path, null).then(() => undefined);
      inFlight.add(request);
      void request.finally(() => inFlight.delete(request));
      return held.get(path) ?? null;
    }
    if (seen.status !== "ready") {
      return held.get(path) ?? null;
    }
    const previous = held.get(path);
    // Reference-stable while the value is unchanged. `peek` returns a reference
    // into the store's own source, so an unchanged value IS the same object and
    // this comparison is exact rather than a heuristic.
    if (previous === seen.data) {
      return previous;
    }
    held.set(path, seen.data);
    return seen.data;
  };

  return {
    ready: Promise.resolve(),
    adapter: {
      name: "stores",
      subscribe(path) {
        let subscriber = subscribers.get(path);
        if (subscriber === undefined) {
          const fieldId = `react-field-${++fieldIds}`;
          subscriber = (onChange: () => void) => {
            const off = system.sourceStore.addListener(path, fieldId, () => {
              // The event says a value moved; `getSnapshot` is what learns what
              // it moved to. Nothing is read here — telling React and then
              // letting React ask is what keeps one wake to one render.
              onChange();
            });
            // No mount read. `getSnapshot` already answered synchronously before
            // this ran, which is the whole point: the first paint has the value.
            return off;
          };
          subscribers.set(path, subscriber);
        }
        return subscriber;
      },
      getSnapshot(path) {
        return snapshot(path);
      },
      async type(module, path, value) {
        await system.patchStore.createPatch(
          module as ModuleFilePath,
          [{ op: "replace", path: patchPathOf(path), value }],
          undefined,
          // The typing field's own id, so per-instance suppression is exercised
          // rather than bypassed.
          subscriberFieldId(subscribers, path),
        );
      },
      async settle() {
        while (inFlight.size > 0) {
          await Promise.all([...inFlight]);
        }
      },
      dispose() {
        system.dispose();
      },
    },
  };
}

/**
 * The field id the stores adapter gave this path.
 *
 * Derived from the subscription order rather than stored separately, so there is
 * one source of truth: an id that drifted from the registered listener would
 * silently disable suppression and make the stores look worse than they are.
 */
function subscriberFieldId(
  subscribers: Map<SourcePath, unknown>,
  path: string,
): string {
  const index = [...subscribers.keys()].indexOf(path as SourcePath);
  return `react-field-${index + 1}`;
}

function patchPathOf(path: string): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath,
  );
  return modulePath === ""
    ? []
    : Internal.splitModulePath(modulePath).map(String);
}

// --------------------------------------------------------------------------
// the run
// --------------------------------------------------------------------------

export async function runReactScenario(
  driverName: string,
  modules: ValModule<SelectorSource>[],
  paths: string[],
  typedModule: string,
  typedPath: string,
): Promise<ReactSample> {
  // One adapter now that the engine is gone. `driverName` stays in the signature
  // because the runner iterates a driver list, and a second adapter — a future
  // alternative, or a deliberately naive one to check a claim against — should
  // drop back in here without the runner changing.
  void driverName;
  const built = storesAdapter(modules);
  await built.ready;
  const adapter = built.adapter;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  renderCount = 0;
  const mountStart = performance.now();
  flushSync(() => {
    root.render(
      <>
        {paths.map((path) => (
          <Field key={path} path={path as SourcePath} adapter={adapter} />
        ))}
      </>,
    );
  });
  // The async reads land after the commit, and the renders they cause are part
  // of mounting — excluding them would credit the stores with a paint that shows
  // no values.
  await adapter.settle();
  flushPendingReact();
  const mountMs = performance.now() - mountStart;
  const mountRenders = renderCount;

  renderCount = 0;
  const keyStart = performance.now();
  await adapter.type(typedModule, typedPath, "typed by react");
  await adapter.settle();
  flushPendingReact();
  const keystrokeMs = performance.now() - keyStart;
  const keystrokeRenders = renderCount;

  const fields = host.querySelectorAll("[data-path]").length;
  root.unmount();
  host.remove();
  adapter.dispose();

  return {
    mountMs,
    keystrokeMs,
    mountRenders,
    keystrokeRenders,
    fields,
  };
}
