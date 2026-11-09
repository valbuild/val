import React from "react";
import type { ResolvableModule } from "@valbuild/core";
import type {
  JsonEntryContentOf,
  Resolvable,
  ResolvedVal,
} from "../stega/stegaEncode";
import type { ReadEnv, ReadOf, Resolution } from "./resolveVal";
import { planOf, resolveVal, resolveValEntry } from "./resolveVal";
import { layered } from "./layered";

/*
 * How the readers wait: the one thing, besides where content comes from,
 * that differs between them. A server read awaits and resolves again; a
 * component suspends (`React.use`) and renders again. Everything before the
 * wait is `resolveVal`.
 */

/** A read that is ready: the value, and what it was read from. */
export type Ready<T> = { value: T; reads: readonly ReadOf[] };

/**
 * How many times a server read may wait before it is a bug: each wait is a
 * source that will have an answer once it has loaded, and a read meets at
 * most a few (the draft, then the entries it names).
 */
const MAX_WAITS = 50;

/**
 * Resolve on the server: wait for what is pending, then resolve again, with
 * the waits that are over handed back (`settled`, see `layered`).
 */
export async function awaitResolved<T>(
  resolve: (settled: ReadonlySet<Promise<void>>) => Resolution<T>,
): Promise<Ready<T>> {
  const settled = new Set<Promise<void>>();
  for (let waited = 0; ; waited++) {
    const r = resolve(settled);
    if (r.status === "ready") {
      return { value: r.value, reads: r.reads };
    }
    if (waited >= MAX_WAITS) {
      throw new Error(
        `A content read was still waiting after ${MAX_WAITS} answers: a source answered "pending" without ever becoming ready.`,
      );
    }
    await Promise.all(r.waits);
    for (const wait of r.waits) settled.add(wait);
  }
}

/**
 * Resolve in a component: subscribe to the modules `selector` reads, and
 * suspend on what is pending (`React.use`, which the caller's `<Suspense>`
 * boundary waits on). The one hook every client reader of both frameworks is
 * built on; `env` is the framework's.
 *
 * Re-renders when a source says a read of those modules would answer
 * differently -- `revision` is a string, so `useSyncExternalStore` compares
 * it with `===` and a render that moves nothing re-renders nothing.
 */
export function useResolved<T>(
  selector: unknown,
  env: ReadEnv,
  resolve: (settled: ReadonlySet<Promise<void>>) => Resolution<T>,
): T {
  const modules = planOf(selector).modules;
  const subscribe = React.useCallback(
    (onChange: () => void) => layered(env.sources).subscribe(modules, onChange),
    [env, modules],
  );
  const revision = () => layered(env.sources).revision(modules);
  React.useSyncExternalStore(subscribe, revision, revision);
  const settled = new Set<Promise<void>>();
  for (;;) {
    const r = resolve(settled);
    if (r.status === "ready") {
      return r.value;
    }
    // Every wait the read met, together, as the server awaits them: one
    // suspension for a whole record's entries, not one per entry (each a
    // render that resolves the whole read again). Returns only once they
    // are all over (it throws to suspend until then), and then the read is
    // made again: what it waited for is in, or -- a source still waiting on
    // it -- did not come, and is passed over.
    React.use(allOf(r.waits));
    for (const wait of r.waits) settled.add(wait);
  }
}

/**
 * The waits a read met, as one promise -- the SAME promise for the same
 * waits, render after render, which `React.use` needs (one made afresh each
 * render is never seen to settle). Kept beside the first wait.
 */
const combined = new WeakMap<
  Promise<void>,
  { waits: readonly Promise<void>[]; all: Promise<void> }[]
>();

function allOf(waits: readonly Promise<void>[]): Promise<void> {
  const [first] = waits;
  if (first === undefined) return Promise.resolve();
  if (waits.length === 1) return first;
  const held = combined.get(first) ?? [];
  const found = held.find(
    (entry) =>
      entry.waits.length === waits.length &&
      entry.waits.every((wait, i) => wait === waits[i]),
  );
  if (found !== undefined) return found.all;
  const all = Promise.all(waits).then(() => undefined);
  held.push({ waits: [...waits], all });
  combined.set(first, held);
  return all;
}

/**
 * `useVal`, for both frameworks: the one hook that was `useValStega` in each,
 * with the framework's env (its overlay, its snapshot, its rule for edit
 * tags). `entries: false` for a reader that needs a `.jsonValues()` record's
 * keys and not its entries.
 */
export function useResolvedVal<T extends Resolvable>(
  selector: T,
  env: ReadEnv,
  opts?: { entries?: boolean },
): ResolvedVal<T> {
  return useResolved(selector, env, (settled) =>
    resolveVal(selector, env, { settled, ...opts }),
  );
}

const NOTHING: Resolution<undefined> = {
  status: "ready",
  value: undefined,
  reads: [],
};

/**
 * `useValKey`, for both frameworks: one `.jsonValues()` entry, loading that
 * entry and no other. `key: null` reads nothing (a route the params did not
 * match), and still subscribes, so the hooks of a component stay the same.
 */
export function useResolvedEntry<T extends ResolvableModule>(
  selector: T,
  key: string | null,
  env: ReadEnv,
): JsonEntryContentOf<T> | undefined {
  return useResolved<JsonEntryContentOf<T> | undefined>(
    selector,
    env,
    (settled) =>
      key === null ? NOTHING : resolveValEntry(selector, key, env, { settled }),
  );
}

/** A `fetchVal` that also says what it read. */
export type FetchValWithReads = <T extends Resolvable>(
  selector: T,
) => Promise<Ready<ResolvedVal<T>>>;

const fetchValReads = new WeakMap<object, FetchValWithReads>();

/**
 * The public `fetchVal` of a framework: `withReads`, giving the value only.
 * The reads stay reachable, from the function, for the scenario world
 * (`scenarios/`), which records the version beside the value a loader shows
 * and must call the same function the product does to get it
 * ({@link readsOfFetchVal}). Nothing in the product asks.
 */
export function fetchValFrom(withReads: FetchValWithReads) {
  const fetchVal = async <T extends Resolvable>(
    selector: T,
  ): Promise<ResolvedVal<T>> => (await withReads(selector)).value;
  fetchValReads.set(fetchVal, withReads);
  return fetchVal;
}

/** The read behind a `fetchVal` made by {@link fetchValFrom}. */
export function readsOfFetchVal(fetchVal: object): FetchValWithReads | null {
  return fetchValReads.get(fetchVal) ?? null;
}
