import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { PatchSetRequest } from "./PatchSetStore";
import type { SourceSnapshot, WorkerSearchResult } from "./SearchStore";
import type {
  Reference,
  ReferenceQuery,
  ReferenceScan,
  ReferenceSnapshot,
} from "./ReferenceStore";

/**
 * The worker seam, as an actual seam.
 *
 * `bridges.ts` describes what kind of boundary this is; `workerSeam.test.ts`
 * establishes that it CAN be crossed (everything is structured-cloneable, and
 * nothing is read synchronously any more). This is the crossing.
 *
 * ## What the bridges are
 *
 * Nothing new. The three worker-realm stores already satisfy these interfaces
 * structurally, because making the seam crossable meant making every method
 * `async` and every input an argument. So the in-process implementation of each
 * bridge IS the store, and `createSystem` takes them as options exactly the way
 * it takes `SchemaValidationBridge` — the default is the store, and a real
 * worker drops in without any store changing.
 *
 * That is the whole claim `architecture.md` has been making about the realm
 * split, and this file is what makes it checkable rather than aspirational.
 *
 * ## What does NOT cross, and must not be quietly lost
 *
 * Two things, both per-realm by nature:
 *
 * - **Events.** The worker stores emit on their own `StoreBus`. `EventTarget`
 *   dispatch is per-realm, so a `search:build-index` emitted inside a worker
 *   never reaches the host's ledger. Forwarding them is possible and is NOT done
 *   here: every event would become a message, and the events these stores emit
 *   are diagnostics rather than coordination — nothing in the host waits on one.
 * - **Activity.** Same reasoning, more sharply: the point of `noopActivity` is
 *   that an uninstrumented run pays one returning method call. Shipping work
 *   records over a wire would make instrumentation cost messages.
 *
 * So an instrumented run with a real worker gets TWO ledgers, and a test that
 * asserts a worker-realm work count has to read the worker's. That is a real
 * consequence of moving these stores, and it is named here rather than
 * discovered later.
 */

/** Search, across the seam. Satisfied as-is by `SearchStore`. */
export interface SearchBridge {
  reindex(snapshot: SourceSnapshot): Promise<{
    new: ModuleFilePath[];
    all: ModuleFilePath[];
  }>;
  buildIndex(snapshot: SourceSnapshot): Promise<{
    new: ModuleFilePath[];
    all: ModuleFilePath[];
  }>;
  search(
    query: string,
    limit?: number,
    offset?: number,
  ): Promise<WorkerSearchResult>;
  forget(moduleFilePath: ModuleFilePath): Promise<void>;
}

/**
 * Patch sets, across the seam. Satisfied as-is by `PatchSetStore`.
 *
 * One argument, and it is a union whose smallest member is empty. That shape is
 * load-bearing here rather than cosmetic: this call used to take the whole patch
 * chain plus every serialized schema in the project, which measured at 1.1 MB
 * cloned per call to do 0.1 ms of work — the worst row in `bench/`'s worker-seam
 * table by two orders of magnitude. `PatchSetRequest` carries only the delta, and
 * nothing at all when there is no delta.
 */
export interface PatchSetBridge {
  getPatchSets(request: PatchSetRequest): Promise<SerializedPatchSet>;
}

/** References, across the seam. Satisfied as-is by `ReferenceStore`. */
export interface ReferenceBridge {
  rescan(snapshot: ReferenceSnapshot): Promise<ModuleFilePath[]>;
  find(query: ReferenceQuery): Promise<ReferenceScan>;
  at(path: SourcePath): Promise<Reference | null>;
  forget(moduleFilePath: ModuleFilePath): Promise<void>;
}

export type WorkerRealmBridges = {
  search: SearchBridge;
  patchSets: PatchSetBridge;
  references: ReferenceBridge;
};

/**
 * The minimum a transport has to offer.
 *
 * Deliberately not `Worker` and not `MessagePort`: a browser `Worker` delivers
 * through `addEventListener("message", event => event.data)` and a node
 * `MessagePort` through `.on("message", data => data)`. Two lines of adapter
 * each, and in exchange this file imports nothing from either environment — so
 * it can live in a browser bundle that must never see `node:worker_threads`.
 */
export type MessageEndpoint = {
  post(message: unknown): void;
  /** Returns an unsubscribe. */
  onMessage(handler: (message: unknown) => void): () => void;
};

/** Adapter for anything with the DOM `postMessage`/`addEventListener` shape. */
export function domEndpoint(target: {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
}): MessageEndpoint {
  return {
    post: (message) => target.postMessage(message),
    onMessage: (handler) => {
      const listener = (event: MessageEvent) => handler(event.data);
      target.addEventListener("message", listener);
      return () => target.removeEventListener("message", listener);
    },
  };
}

type Call = {
  val: "call";
  id: number;
  store: "search" | "patchSets" | "references";
  method: string;
  args: unknown[];
};

type Reply =
  | { val: "reply"; id: number; ok: true; value: unknown }
  | { val: "reply"; id: number; ok: false; message: string };

function isReply(message: unknown): message is Reply {
  return (
    typeof message === "object" &&
    message !== null &&
    "val" in message &&
    (message as { val?: unknown }).val === "reply"
  );
}

function isCall(message: unknown): message is Call {
  return (
    typeof message === "object" &&
    message !== null &&
    "val" in message &&
    (message as { val?: unknown }).val === "call"
  );
}

/**
 * HOST side: bridges that forward every call over `endpoint`.
 *
 * One id counter and one pending map for all three stores, because they share
 * one channel — a second channel would buy nothing and would double the
 * setup a caller has to get right.
 *
 * `dispose` rejects everything still in flight. A promise that never settles is
 * the one failure a caller can neither render nor retry, so a closed transport
 * has to become an error rather than silence.
 */
export function createWorkerBridges(
  endpoint: MessageEndpoint,
): WorkerRealmBridges & {
  dispose(): void;
} {
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let closed = false;

  const off = endpoint.onMessage((message) => {
    if (!isReply(message)) return;
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    if (message.ok) {
      waiting.resolve(message.value);
    } else {
      waiting.reject(new Error(message.message));
    }
  });

  const call = (
    store: Call["store"],
    method: string,
    args: unknown[],
  ): Promise<unknown> => {
    if (closed) {
      return Promise.reject(new Error("The worker bridge is closed"));
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        endpoint.post({ val: "call", id, store, method, args });
      } catch (error) {
        // A `DataCloneError` surfaces HERE, at the call that caused it, rather
        // than as an unhandled rejection with no stack pointing at the payload.
        pending.delete(id);
        reject(
          new Error(
            `Could not send ${store}.${method} across the worker seam: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    });
  };

  /**
   * A typed method that forwards.
   *
   * `as never` rather than `as any`: the forwarder genuinely cannot be typed
   * against every bridge signature at once, and `never` is assignable to each
   * without widening anything — the interfaces above are what checks the call
   * sites, and they are checked at every use.
   */
  const forward = <T>(store: Call["store"], method: string) =>
    ((...args: unknown[]) => call(store, method, args) as Promise<T>) as never;

  return {
    search: {
      reindex: forward("search", "reindex"),
      buildIndex: forward("search", "buildIndex"),
      search: forward("search", "search"),
      forget: forward("search", "forget"),
    },
    patchSets: {
      getPatchSets: forward("patchSets", "getPatchSets"),
    },
    references: {
      rescan: forward("references", "rescan"),
      find: forward("references", "find"),
      at: forward("references", "at"),
      forget: forward("references", "forget"),
    },
    dispose() {
      closed = true;
      off();
      for (const [, waiting] of pending) {
        waiting.reject(new Error("The worker bridge was disposed"));
      }
      pending.clear();
    },
  };
}

/**
 * WORKER side: answer calls from `endpoint` out of `stores`.
 *
 * The method is looked up on the store rather than switched on, because the
 * bridge interfaces above are the contract and a switch would be a second place
 * to keep in step. An unknown method is an error reply, not a dropped message:
 * a caller waiting forever on a typo is the worst possible failure here.
 */
export function serveWorkerRealm(
  endpoint: MessageEndpoint,
  stores: WorkerRealmBridges,
): () => void {
  return endpoint.onMessage((message) => {
    if (!isCall(message)) return;
    const { id, store: storeName, method, args } = message;
    const store: unknown = stores[storeName];
    const reply = (result: Reply) => {
      try {
        endpoint.post(result);
      } catch (error) {
        // The RESULT could not be cloned. Reply with the failure instead, so the
        // caller learns rather than hanging.
        endpoint.post({
          val: "reply",
          id,
          ok: false,
          message: `Could not return ${storeName}.${method} across the worker seam: ${
            error instanceof Error ? error.message : String(error)
          }`,
        } satisfies Reply);
      }
    };
    if (typeof store !== "object" || store === null) {
      reply({
        val: "reply",
        id,
        ok: false,
        message: `No such store: ${storeName}`,
      });
      return;
    }
    const fn = (store as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      reply({
        val: "reply",
        id,
        ok: false,
        message: `No such method: ${storeName}.${method}`,
      });
      return;
    }
    void (async () => {
      try {
        const value = await (fn as (...a: unknown[]) => unknown).apply(
          store,
          args,
        );
        reply({ val: "reply", id, ok: true, value });
      } catch (error) {
        reply({
          val: "reply",
          id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}
