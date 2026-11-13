import {
  ComponentProps,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createValueStore,
  useStoreValue,
  type ValueStore,
} from "../../stores/react/useStoreValue";
import { ActivitySheet } from "./ActivitySheet";
import { ChangesSheet } from "./ChangesSheet";
import { GlobalSearch, type SearchResult } from "./GlobalSearch";
import { LeftRail } from "./LeftRail";
import { StatusBar, type SaveState } from "./StatusBar";
import { StudioTour, type TourObserved } from "./StudioTour";
import { PublishButton, TopBar } from "./TopBar";
import { UtilityPanel } from "./UtilityPanel";
import type { ShellActivityEntry } from "./types";

/**
 * What the shell shows that a field write moves: whether the write is saved
 * yet, how many changes are pending, and Recent activity.
 *
 * ## Why these are not props of the frame
 *
 * They were, and `Shell` renders everything from one component: the rail,
 * the bars, every panel, the editor and the canvas. A write moves the save
 * state twice, the count once and the activity once, so each write was four
 * renders of the whole Studio for four words in its chrome
 * (`docs/plans/studio-write-lag.md`).
 *
 * So `Shell` takes them as the props they always were, puts them in a store
 * here, and renders the rest -- `ShellFrame`, a `memo` -- from the props
 * that are left. A write then reaches the components below, each of which
 * reads the one value it shows (`useShellLive`) and renders when that value
 * moves: the status bar for the save state, the top bar for the count.
 *
 * Add to this, rather than to the frame's props, anything else the shell
 * comes to show that moves with a write. A prop of the frame that moves per
 * write is the whole Studio rendering per write again.
 */
export type ShellLive = {
  saveState: SaveState;
  onRetrySave: (() => void) | undefined;
  pendingChanges: number;
  /** As `ShellProps.reviewCount`: `undefined` is "the pending changes". */
  reviewCount: number | undefined;
  onDiscardAll: (() => void) | undefined;
  discardAllDescription: string | undefined;
  activity: ShellActivityEntry[] | undefined;
};

const ShellLiveContext = createContext<ValueStore<ShellLive> | null>(null);

/**
 * Holds `value` for the shell's live readers. `value` must be the same
 * object while nothing in it moved (a `useMemo`).
 */
export function ShellLiveProvider({
  value,
  children,
}: {
  value: ShellLive;
  children: ReactNode;
}) {
  const [store] = useState(() => createValueStore(value));
  // From an effect, never while rendering: the readers are other components.
  useEffect(() => {
    store.set(value);
  }, [store, value]);
  return (
    <ShellLiveContext.Provider value={store}>
      {children}
    </ShellLiveContext.Provider>
  );
}

/**
 * One value of {@link ShellLive}; the reader renders when it moves.
 *
 * `select` must be stable -- one of the functions below, never an inline
 * arrow -- and must hand back something that is the same while it says the
 * same: a number, a string, or an object the provider's value holds.
 */
function useShellLive<T>(select: (live: ShellLive) => T): T {
  const store = useContext(ShellLiveContext);
  if (store === null) {
    throw new Error("useShellLive: used outside of ShellLiveProvider");
  }
  const read = useCallback(() => select(store.get()), [store, select]);
  return useStoreValue(store.subscribe, read);
}

const saveStateOf = (live: ShellLive) => live.saveState;
const onRetrySaveOf = (live: ShellLive) => live.onRetrySave;
const pendingChangesOf = (live: ShellLive) => live.pendingChanges;
const hasPendingChangesOf = (live: ShellLive) => live.pendingChanges > 0;
const reviewCountOf = (live: ShellLive) =>
  live.reviewCount ?? live.pendingChanges;
const tourReviewCountOf = (live: ShellLive) => live.reviewCount ?? 0;
const onDiscardAllOf = (live: ShellLive) => live.onDiscardAll;
const discardAllDescriptionOf = (live: ShellLive) => live.discardAllDescription;
const activityOf = (live: ShellLive) => live.activity;

/*
 * The shell's own components, each with the live values it shows read here
 * rather than passed by the frame. Every one takes the component's props
 * without those values, and nothing else about it changes.
 */

export function LiveLeftRail(
  props: Omit<ComponentProps<typeof LeftRail>, "hasDraftChanges">,
) {
  return (
    <LeftRail {...props} hasDraftChanges={useShellLive(hasPendingChangesOf)} />
  );
}

export function LiveTopBar(
  props: Omit<ComponentProps<typeof TopBar>, "pendingChanges" | "reviewCount">,
) {
  return (
    <TopBar
      {...props}
      pendingChanges={useShellLive(pendingChangesOf)}
      reviewCount={useShellLive(reviewCountOf)}
    />
  );
}

/** The shell's own Publish button, where the app handed it no `publishSlot`. */
export function LivePublishButton(
  props: Omit<ComponentProps<typeof PublishButton>, "pendingChanges">,
) {
  return (
    <PublishButton {...props} pendingChanges={useShellLive(pendingChangesOf)} />
  );
}

export function LiveStatusBar(
  props: Omit<ComponentProps<typeof StatusBar>, "saveState" | "onRetrySave">,
) {
  return (
    <StatusBar
      {...props}
      saveState={useShellLive(saveStateOf)}
      onRetrySave={useShellLive(onRetrySaveOf)}
    />
  );
}

export function LiveUtilityPanel(
  props: Omit<
    ComponentProps<typeof UtilityPanel>,
    | "activity"
    | "reviewCount"
    | "pendingChanges"
    | "onDiscardAll"
    | "discardAllDescription"
  >,
) {
  return (
    <UtilityPanel
      {...props}
      activity={useShellLive(activityOf)}
      reviewCount={useShellLive(reviewCountOf)}
      pendingChanges={useShellLive(pendingChangesOf)}
      onDiscardAll={useShellLive(onDiscardAllOf)}
      discardAllDescription={useShellLive(discardAllDescriptionOf)}
    />
  );
}

export function LiveActivitySheet(
  props: Omit<ComponentProps<typeof ActivitySheet>, "activity">,
) {
  return <ActivitySheet {...props} activity={useShellLive(activityOf)} />;
}

export function LiveChangesSheet(
  props: Omit<
    ComponentProps<typeof ChangesSheet>,
    "reviewCount" | "pendingChanges" | "onDiscardAll" | "discardAllDescription"
  >,
) {
  return (
    <ChangesSheet
      {...props}
      reviewCount={useShellLive(reviewCountOf)}
      pendingChanges={useShellLive(pendingChangesOf)}
      onDiscardAll={useShellLive(onDiscardAllOf)}
      discardAllDescription={useShellLive(discardAllDescriptionOf)}
    />
  );
}

/** The tour, with how many changes Review counts among what it watches. */
export function LiveStudioTour({
  observed,
  ...props
}: Omit<ComponentProps<typeof StudioTour>, "observed"> & {
  observed: Omit<TourObserved, "reviewCount">;
}) {
  const reviewCount = useShellLive(tourReviewCountOf);
  const withReviewCount = useMemo<TourObserved>(
    () => ({ ...observed, reviewCount }),
    [observed, reviewCount],
  );
  return <StudioTour {...props} observed={withReviewCount} />;
}

/**
 * How many recent changes the search offers before anything is typed. See
 * {@link LiveGlobalSearch}.
 */
const RECENT_SEARCH_LIMIT = 5;

/**
 * The search, with the last few things that changed as its first rows.
 *
 * From the activity feed, which is the patch sets — already newest first and
 * already grouped by the thing that changed. Five, because this is a "take me
 * back" list rather than a history: past that it stops being a shortcut and
 * starts being something to read.
 *
 * Changes only: the feed also carries publishes, and a search result is a
 * thing to open. Filtered BEFORE the slice, so a busy publishing afternoon
 * does not leave the recent list short.
 */
export function LiveGlobalSearch(
  props: Omit<ComponentProps<typeof GlobalSearch>, "recentResults">,
) {
  const activity = useShellLive(activityOf);
  const recentResults = useMemo(
    (): SearchResult[] =>
      (activity ?? [])
        .filter((entry) => entry.kind === "change")
        .slice(0, RECENT_SEARCH_LIMIT)
        .map((entry) => ({
          id: entry.sourcePath,
          kind: "recent",
          label: entry.title,
          detail: entry.author
            ? `${entry.timestamp} · ${entry.author}`
            : entry.timestamp,
        })),
    [activity],
  );
  return <GlobalSearch {...props} recentResults={recentResults} />;
}
