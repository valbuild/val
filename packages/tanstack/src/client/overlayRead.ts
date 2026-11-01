import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import { stegaEncode, type Resolvable } from "@valbuild/react/stega";
import {
  fillJsonValuesRecord,
  getJsonEntryStegaRoot,
  getValRouteUrlFromVal,
  jsonValuesRecordToFill,
} from "../routeFromVal";

/**
 * How `useVal` turns what the page holds into the value a component gets:
 * the draft store's source when draft mode is on and the store has the module,
 * else the proposal's saved Source (`snapshot`), else -- `getModule` answering
 * `undefined` -- the bundle's own. Plain functions, so the scenario harness
 * (`scenarios/`) reads a page exactly as the hook does.
 */

/** Where a module's source comes from, for one read. */
export function overlaySourceOf(
  moduleMap: Record<ModuleFilePath, Json> | undefined,
  draftMode: boolean | null,
  snapshot: Record<ModuleFilePath, Json> | undefined,
): (moduleId: string) => Json | undefined {
  return (moduleId) => {
    if (moduleMap && draftMode) {
      const draft = moduleMap[moduleId as ModuleFilePath];
      if (draft !== undefined) {
        return draft;
      }
    }
    // At a proposal's address: its saved Source, not the bundle's.
    return snapshot?.[moduleId as ModuleFilePath];
  };
}

/**
 * The value, encoded with edit tags when `encodes`. `filled` is a whole
 * `.jsonValues()` record with its entries loaded, which the hook loads (it
 * suspends on them) and hands in.
 */
export function readWithOverlay<T extends Resolvable>(
  selector: T,
  sourceOf: (moduleId: string) => Json | undefined,
  filled: { modulePath: string; record: Record<string, unknown> | null } | null,
  encodes: boolean,
) {
  return stegaEncode(selector, {
    disabled: !encodes,
    getModule: (moduleId) =>
      filled !== null && moduleId === filled.modulePath
        ? filled.record
        : sourceOf(moduleId),
  });
}

/**
 * How a reader gets entries' committed content -- the bundle's own import of
 * each `*.val.json`. The hook starts every import, then suspends on each
 * (`React.use`); the scenario world resolves them before it reads. One answer
 * per key, in order; `undefined` where the module has no import for a key.
 */
export type CommittedEntries = (
  // Untyped, as `jsonValuesRecordToFill` hands it over.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module: any,
  modulePath: ModuleFilePath,
  keys: string[],
) => unknown[];

/** What the page holds for one read: the draft store's modules, and the snapshot. */
export type OverlayView = {
  moduleMap: Record<ModuleFilePath, Json> | undefined;
  draftMode: boolean | null;
  snapshot: Record<ModuleFilePath, Json> | undefined;
};

/**
 * `useVal`'s read: {@link readWithOverlay}, with a whole `.jsonValues()`
 * record's entries filled in first. Its own source holds only lazy markers,
 * so an entry neither the draft store nor the snapshot has is the bundle's
 * (`committed`).
 */
export function readSelectorWithOverlay<T extends Resolvable>(
  selector: T,
  view: OverlayView,
  encodes: boolean,
  committed: CommittedEntries,
) {
  const sourceOf = overlaySourceOf(
    view.moduleMap,
    view.draftMode,
    view.snapshot,
  );
  const jsonValues = jsonValuesRecordToFill(selector, (modulePath) => [
    view.moduleMap && view.draftMode ? view.moduleMap[modulePath] : undefined,
    view.snapshot?.[modulePath],
  ]);
  if (jsonValues === null) {
    return readWithOverlay(selector, sourceOf, null, encodes);
  }
  const values = committed(
    jsonValues.module,
    jsonValues.modulePath,
    jsonValues.load,
  );
  const loaded: Record<string, unknown> = {};
  jsonValues.load.forEach((key, index) => {
    loaded[key] = values[index];
  });
  return readWithOverlay(
    selector,
    sourceOf,
    {
      modulePath: jsonValues.modulePath,
      record: fillJsonValuesRecord(jsonValues.record, loaded),
    },
    encodes,
  );
}

/**
 * What the draft view says about one `.jsonValues()` entry.
 *
 * Mirrors the server-side rule in `fetchValKey`/`fetchValRoute`: a draft view
 * that HAS an answer wins, including the answer "this entry is gone", and the
 * bundled content is used only when there is no draft view.
 */
export function draftJsonEntry(
  draftSource: Json | undefined,
  key: string,
):
  | { status: "content"; content: unknown }
  | { status: "absent" }
  | { status: "unavailable" } {
  if (draftSource === null) {
    // A nullable record that is null in the draft view: it has no entries.
    return { status: "absent" };
  }
  if (
    draftSource === undefined ||
    typeof draftSource !== "object" ||
    Array.isArray(draftSource)
  ) {
    return { status: "unavailable" };
  }
  // Own keys only: an entry may be named `toString`.
  if (!Object.prototype.hasOwnProperty.call(draftSource, key)) {
    // The module IS in the draft view and this key is not: it was deleted.
    return { status: "absent" };
  }
  const entry: unknown = Object.entries(draftSource).find(
    ([k]) => k === key,
  )?.[1];
  if (Internal.isJson(entry)) {
    // An un-loaded marker: the Studio has not fetched this entry's content, so
    // the draft view cannot answer. (The engine asks for entries that pending
    // patches touch, so this resolves itself for anything actually edited.)
    return { status: "unavailable" };
  }
  return { status: "content", content: entry };
}

/**
 * The draft view's answer for one entry, or -- where it has none, a marker for
 * an entry the Studio has not loaded -- the snapshot's: a proposal's saves over
 * the content version the site serves, with entries filled in. The order the
 * server renders in (`snapshotJsonEntry` in initValContent), so a draft page
 * hydrates to what it was served rather than to the build's older entry.
 */
export function draftOrSnapshotJsonEntry(
  draftSource: Json | undefined,
  snapshotSource: Json | undefined,
  key: string,
): ReturnType<typeof draftJsonEntry> {
  const draft = draftJsonEntry(draftSource, key);
  return draft.status === "unavailable"
    ? draftJsonEntry(snapshotSource, key)
    : draft;
}

/**
 * `useValKey`'s read of one `.jsonValues()` entry: the draft view's answer,
 * else the bundle's (`committed`). `undefined` when the draft view says the
 * entry is gone -- falling back to the bundled entry would render content the
 * editor has just removed.
 */
export function readEntryWithOverlay<M extends ValModule<SelectorSource>>(
  valModule: M,
  key: string,
  draftSource: Json | undefined,
  snapshotSource: Json | undefined,
  encodes: boolean,
  committed: (valModule: M, key: string) => unknown,
) {
  const draft = draftOrSnapshotJsonEntry(draftSource, snapshotSource, key);
  if (draft.status === "absent") {
    return undefined;
  }
  let content: unknown = draft.status === "content" ? draft.content : undefined;
  if (content === undefined) {
    content = committed(valModule, key);
  }
  return stegaEncode(content, {
    disabled: !encodes,
    root: getJsonEntryStegaRoot(valModule, key),
  });
}

/**
 * `useValRoute`'s read for a `.jsonValues()` router: the route's params to
 * the entry's key, then {@link readEntryWithOverlay}'s rule. `null` when the
 * params name no route, or the draft view says the route is gone.
 */
export function readRouteEntryWithOverlay<M extends ValModule<SelectorSource>>(
  valModule: M,
  params: Record<string, string | string[]>,
  draftSource: Json | undefined,
  snapshotSource: Json | undefined,
  encodes: boolean,
  committed: (valModule: M, key: string) => unknown,
) {
  const path = valModule && Internal.getValPath(valModule);
  const schema = valModule && Internal.getSchema(valModule);
  const source = valModule && Internal.getSource(valModule);
  const url = getValRouteUrlFromVal(
    params,
    "useValRoute",
    path,
    schema,
    source,
  );
  if (!url) {
    return null;
  }
  const draft = draftOrSnapshotJsonEntry(draftSource, snapshotSource, url);
  if (draft.status === "absent") {
    return null;
  }
  let content: unknown = draft.status === "content" ? draft.content : undefined;
  if (content === undefined) {
    content = committed(valModule, url);
  }
  if (content === undefined) {
    return null;
  }
  return stegaEncode(content, {
    disabled: !encodes,
    root: getJsonEntryStegaRoot(valModule, url),
  });
}
