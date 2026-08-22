import { useEffect, useRef, useState, useCallback } from "react";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { ChangeTreeNode } from "../utils/computeChangedSourcePaths";
import { computeChangedSourcePaths } from "../utils/computeChangedSourcePaths";
import type {
  PatchSetsWorkerRequest,
  PatchSetsWorkerResponse,
} from "./worker-types";

export interface UsePatchSetsWorkerReturn {
  trees: ChangeTreeNode[];
  isComputing: boolean;
  /**
   * False until a computation has produced a result, so that `trees` being
   * empty can be told apart from "there is nothing to show". Without it the
   * initial empty `trees` reads as "no changes" for the frame before the first
   * computation is even posted to the worker.
   *
   * Reset by `reloadKey`, since a reload has no result yet either.
   */
  hasComputed: boolean;
}

const supportsWorker =
  typeof window !== "undefined" && typeof Worker !== "undefined";

/**
 * @param reloadKey Change this to reload from scratch: the previously computed
 *   trees are dropped (so consumers fall back to their loading state) instead
 *   of staying on screen while the new ones are computed. Use it when the input
 *   the trees were derived from is no longer valid - after a publish, say - and
 *   showing the previous result would be showing stale data.
 */
export function usePatchSetsWorker(
  patchSets: SerializedPatchSet,
  reloadKey?: unknown,
): UsePatchSetsWorkerReturn {
  const workerRef = useRef<Worker | null>(null);
  const [trees, setTrees] = useState<ChangeTreeNode[]>([]);
  // A computation is posted from an effect on mount, so one is always pending
  // for the first render: starting at false would show the computed-and-empty
  // state before anything has been computed.
  const [isComputing, setIsComputing] = useState(true);
  const [hasComputed, setHasComputed] = useState(false);
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supportsWorker) return;

    const worker = new Worker(
      new URL("./patchsets.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PatchSetsWorkerResponse>) => {
      const response = event.data;

      if (response.id !== latestRequestIdRef.current) return;

      if (response.type === "result") {
        setTrees(response.trees);
        setIsComputing(false);
        setHasComputed(true);
      } else if (response.type === "error") {
        console.error("PatchSets worker error:", response.error);
        setIsComputing(false);
        // Nothing more is coming for this request: treat the failure as a
        // result so the view leaves its loading state.
        setHasComputed(true);
      }
    };

    worker.onerror = (event) => {
      console.error("PatchSets worker failed:", event.message);
      setIsComputing(false);
      setHasComputed(true);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const compute = useCallback((data: SerializedPatchSet) => {
    if (!workerRef.current) {
      // Fallback: compute on main thread if worker not available
      const { trees } = computeChangedSourcePaths(data);
      setTrees(trees);
      setIsComputing(false);
      setHasComputed(true);
      return;
    }

    const id = `ps-${requestIdRef.current++}`;
    latestRequestIdRef.current = id;
    setIsComputing(true);

    const request: PatchSetsWorkerRequest = {
      type: "compute",
      id,
      patchSets: data,
    };
    workerRef.current.postMessage(request);
  }, []);

  // Reset DURING render, not in an effect. An effect runs after the render that
  // saw the new key has already returned, so that render still hands back the
  // previous trees with hasComputed: true - i.e. the consumer paints the stale
  // pre-publish diff for a frame, which is exactly what reloadKey exists to
  // prevent. Setting state while rendering makes React re-run this component
  // with the cleared state before committing anything (the documented
  // "adjusting state when a prop changes" pattern).
  const [computedForKey, setComputedForKey] = useState(reloadKey);
  if (computedForKey !== reloadKey) {
    setComputedForKey(reloadKey);
    setTrees([]);
    setHasComputed(false);
    setIsComputing(true);
  }

  useEffect(() => {
    compute(patchSets);
  }, [patchSets, compute, reloadKey]);

  return { trees, isComputing, hasComputed };
}
