import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValModule,
  type ValModules,
  initVal,
} from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import { ValSyncEngine } from "../ValSyncEngine";
import { createSystem, type System } from "../stores/createSystem";
import type { Revision } from "../stores/types";

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
 * `get` is async, so `useSyncExternalStore` cannot call it. The adapter keeps a
 * per-path cache, `subscribe` registers the real per-path listener and kicks an
 * async read that updates the cache and notifies React, and `getSnapshot`
 * returns the cached object. That is the shape the hook has to take; it is not a
 * shortcut.
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
// engine adapter
// --------------------------------------------------------------------------

const refusingClient: ValClient = async (route, method) => {
  throw new Error(
    `The React benchmark took a network path it should not have: ` +
      `${String(method)} ${String(route)}.`,
  );
};

function engineAdapter(modules: ValModule<SelectorSource>[]): {
  adapter: FieldAdapter;
  ready: Promise<void>;
} {
  const { config } = initVal();
  const engine = new ValSyncEngine(refusingClient, undefined, undefined);
  const valModules: ValModules = {
    config,
    modules: modules.map((module) => ({
      def: () => Promise.resolve({ default: module }),
    })),
  };
  const ready = engine.setValModules(valModules);
  let now = 0;
  // Memoised per module, because `subscribe` is called on every render and
  // `useSyncExternalStore` resubscribes when the function identity changes. The
  // real `ValFieldProvider` has the same requirement.
  const subscribers = new Map<
    ModuleFilePath,
    (onChange: () => void) => () => void
  >();
  return {
    ready,
    adapter: {
      name: "ValSyncEngine",
      subscribe(path) {
        const [moduleFilePath] =
          Internal.splitModuleFilePathAndModulePath(path);
        let subscriber = subscribers.get(moduleFilePath);
        if (subscriber === undefined) {
          subscriber = engine.subscribe("source", moduleFilePath);
          subscribers.set(moduleFilePath, subscriber);
        }
        return subscriber;
      },
      getSnapshot(path) {
        const [moduleFilePath] =
          Internal.splitModuleFilePathAndModulePath(path);
        // Per module and cached, exactly as `ValFieldProvider` reads it. The
        // cache is what keeps the reference stable between invalidations.
        return engine.getSourceSnapshot(moduleFilePath);
      },
      async type(_module, path, value) {
        engine.addPatch(
          path as SourcePath,
          "string",
          [{ op: "replace", path: patchPathOf(path), value }],
          ++now,
        );
      },
      async settle() {
        await Promise.resolve();
      },
      dispose() {},
    },
  };
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

  /** Cached read results, one per path — what `getSnapshot` hands React. */
  const cache = new Map<
    SourcePath,
    { revision: Revision | null; value: unknown }
  >();
  const subscribers = new Map<
    SourcePath,
    (onChange: () => void) => () => void
  >();
  const inFlight = new Set<Promise<void>>();
  let fieldIds = 0;

  const read = (path: SourcePath, notify: () => void): void => {
    const held = cache.get(path);
    const request = (async () => {
      const result = await system.sourceStore.get(path, held?.revision ?? null);
      if (result.status === "resolved-head") {
        cache.set(path, { revision: result.revision, value: result.data });
        notify();
      } else if (result.status === "unchanged") {
        // Nothing to tell React: the cached object is still right, and calling
        // `notify` here would make the cheap path cost a render — which is the
        // whole thing the protocol exists to avoid.
        cache.set(path, {
          revision: result.revision,
          value: held?.value ?? null,
        });
      } else if (held === undefined) {
        cache.set(path, { revision: null, value: null });
        notify();
      }
    })();
    inFlight.add(request);
    void request.finally(() => inFlight.delete(request));
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
              // A foreign change: re-read, then tell React. The read is what
              // learns the new value; the event only says one exists.
              read(path, onChange);
            });
            // The mount read. Async, so the first paint may show nothing and the
            // value arrives a microtask later — which is the real cost of an
            // async protocol and is deliberately not hidden here.
            read(path, onChange);
            return off;
          };
          subscribers.set(path, subscriber);
        }
        return subscriber;
      },
      getSnapshot(path) {
        return cache.get(path)?.value ?? null;
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
  const built =
    driverName === "ValSyncEngine"
      ? engineAdapter(modules)
      : storesAdapter(modules);
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
