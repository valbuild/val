/**
 * A typed wrapper over a native `EventTarget`.
 *
 * Every store owns one. Stores talk to each other by listening on each other's
 * bus — no store holds a reference to another store's state, and no store calls
 * another store's mutator.
 *
 * ## Why native events, and what that costs
 *
 * `EventTarget` dispatch is per-realm: an event dispatched in one thread is not
 * observable in another. So a set of stores can only communicate this way while
 * they share a realm. That is the point rather than a limitation — the whole set
 * is designed to be relocated into ONE worker, where the stores keep talking to
 * each other natively and only the boundary to the main thread is
 * `postMessage`. Splitting the stores across N workers would replace every
 * arrow in the graph with a structured clone.
 *
 * Nothing in this file touches `window`, `document`, or React, so it runs
 * unchanged on the main thread, inside a worker, and in a node test.
 */
export class StoreBus<E extends { type: string }> {
  private readonly target = new EventTarget();

  /**
   * Dispatched alongside every event so an observer (the test ledger, a
   * devtools panel) can watch the whole bus. `EventTarget` has no wildcard
   * listener, and inventing a registry to get one would throw away the native
   * per-type filtering that real consumers rely on — so events go out twice
   * instead, once under their own name and once under this one.
   */
  private static readonly ANY = "val:any";

  emit(event: E): void {
    // ANY first, and the order is load-bearing for observers.
    //
    // Dispatch is synchronous, so a listener on the named event can emit its own
    // consequence before this call returns. If the named event went first, that
    // consequence would reach an ANY observer BEFORE its cause — a ledger would
    // read `validation:invalidate` then `schema:init`, inverting causality and
    // making an event log useless for debugging exactly the ordering it exists
    // to show.
    this.target.dispatchEvent(new CustomEvent(StoreBus.ANY, { detail: event }));
    this.target.dispatchEvent(new CustomEvent(event.type, { detail: event }));
  }

  on<T extends E["type"]>(
    type: T,
    listener: (event: Extract<E, { type: T }>) => void,
  ): () => void {
    const handler = (ev: Event) => {
      listener((ev as CustomEvent<Extract<E, { type: T }>>).detail);
    };
    this.target.addEventListener(type, handler);
    return () => this.target.removeEventListener(type, handler);
  }

  onAny(listener: (event: E) => void): () => void {
    const handler = (ev: Event) => {
      listener((ev as CustomEvent<E>).detail);
    };
    this.target.addEventListener(StoreBus.ANY, handler);
    return () => this.target.removeEventListener(StoreBus.ANY, handler);
  }
}
