import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import {
  moduleAnalyticsOf,
  pathKey,
  type ContentViews,
  type ModuleAnalytics,
} from "./moduleAnalytics";

/**
 * Content analytics beside the content being edited: how many page views
 * each field, list item and module was on the page in, and on screen in.
 *
 * Asked of Val Build once per module, when something in it is first shown,
 * and kept for `FRESH_MS`: every badge in a module reads the one answer.
 * Nothing is asked, and nothing is shown, where it cannot be answered -- a
 * Studio not connected to Val Build, the demo, a project with analytics
 * off. A failed request shows nothing either: the numbers are a hint beside
 * the work, not the work, and an error beside every field would be louder
 * than what it is missing.
 */

const FRESH_MS = 5 * 60 * 1000;

type Entry =
  | { status: "loading" }
  | { status: "done"; analytics: ModuleAnalytics | null; at: number };

export type ContentAnalyticsStore = {
  /** Asks for a module's numbers, unless they are already here and fresh. */
  demand(module: ModuleFilePath): void;
  get(module: ModuleFilePath): Entry | undefined;
  subscribe(listener: () => void): () => void;
};

export const ContentAnalyticsContext =
  createContext<ContentAnalyticsStore | null>(null);

/**
 * The store behind the badges: `ask` is Val Build's answer for one module,
 * as JSON, or null when there is none to have. Every badge in a module reads
 * the one answer.
 */
export function createContentAnalyticsStore(
  ask: (module: ModuleFilePath) => Promise<unknown>,
): ContentAnalyticsStore {
  const entries = new Map<ModuleFilePath, Entry>();
  const listeners = new Set<() => void>();
  const set = (module: ModuleFilePath, entry: Entry) => {
    entries.set(module, entry);
    for (const listener of listeners) listener();
  };
  return {
    demand(module) {
      const found = entries.get(module);
      if (
        found?.status === "loading" ||
        (found?.status === "done" && Date.now() - found.at < FRESH_MS)
      ) {
        return;
      }
      set(module, { status: "loading" });
      ask(module)
        .then((json) => {
          set(module, {
            status: "done",
            analytics: json === null ? null : moduleAnalyticsOf(json),
            at: Date.now(),
          });
        })
        .catch((error: unknown) => {
          Internal.log.debug("content analytics not shown", error);
          set(module, { status: "done", analytics: null, at: Date.now() });
        });
    },
    get: (module) => entries.get(module),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const nothing = () => () => undefined;

/**
 * How many page views `path` was on the page in, and on screen in -- it, or
 * anything inside it -- with the range that covers. Null while it is not
 * known, and where there is nothing to show.
 */
export function useContentViews(
  path: SourcePath | ModuleFilePath,
): { views: ContentViews; from: string; to: string } | null {
  const store = useContext(ContentAnalyticsContext);
  const [module] = Internal.splitModuleFilePathAndModulePath(path);
  useEffect(() => {
    store?.demand(module);
  }, [store, module]);
  const entry = useSyncExternalStore(store?.subscribe ?? nothing, () =>
    store?.get(module),
  );
  return useMemo(() => {
    if (entry?.status !== "done" || entry.analytics === null) return null;
    const views = entry.analytics.byKey.get(pathKey(path));
    return views === undefined
      ? null
      : { views, from: entry.analytics.from, to: entry.analytics.to };
  }, [entry, path]);
}

/**
 * What is directly inside `path`, most seen first, at most `limit` of it:
 * the rows of a list, the fields of an object.
 */
export function useMostSeenInside(
  path: SourcePath | ModuleFilePath,
  limit: number,
): Array<{ path: SourcePath } & ContentViews> {
  const store = useContext(ContentAnalyticsContext);
  const [module] = Internal.splitModuleFilePathAndModulePath(path);
  useEffect(() => {
    store?.demand(module);
  }, [store, module]);
  const entry = useSyncExternalStore(store?.subscribe ?? nothing, () =>
    store?.get(module),
  );
  return useMemo(() => {
    if (entry?.status !== "done" || entry.analytics === null) return [];
    return (entry.analytics.children.get(pathKey(path)) ?? []).slice(0, limit);
  }, [entry, path, limit]);
}
