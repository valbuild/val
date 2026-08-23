import { SearchStore } from "./SearchStore";
import { PatchSetStore } from "./PatchSetStore";
import { ReferenceStore } from "./ReferenceStore";
import { noopActivity, type ActivitySink } from "./activity";
import {
  serveWorkerRealm,
  type MessageEndpoint,
  type WorkerRealmBridges,
} from "./workerBridge";

/**
 * Everything the worker realm is, constructed and served.
 *
 * This module is the realm split made executable. Look at its imports: three
 * stores, an activity sink, and a transport. No `HostStore`, no `SourceStore`,
 * no `Schema`, nothing that could hold a user closure. `architecture.md` has
 * claimed that separation from the start; a file that would fail to load if the
 * claim were false is a better guarantee than a comment saying so.
 *
 * It is transport-agnostic on purpose. A browser worker calls this with
 * `domEndpoint(self)`; a node worker with a two-line `MessagePort` adapter; a
 * test with either. Importing `node:worker_threads` here would put a node
 * built-in in a browser bundle, and importing `self` would put a DOM global in a
 * node test — so it imports neither and takes the endpoint as an argument.
 */
export function startWorkerRealm(
  endpoint: MessageEndpoint,
  activity: ActivitySink = noopActivity,
): { stores: WorkerRealmBridges; stop: () => void } {
  const stores: WorkerRealmBridges = {
    search: new SearchStore(activity),
    patchSets: new PatchSetStore(activity),
    references: new ReferenceStore(activity),
  };
  const stop = serveWorkerRealm(endpoint, stores);
  return { stores, stop };
}
