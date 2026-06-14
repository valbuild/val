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
}

const supportsWorker =
  typeof window !== "undefined" && typeof Worker !== "undefined";

export function usePatchSetsWorker(
  patchSets: SerializedPatchSet,
): UsePatchSetsWorkerReturn {
  const workerRef = useRef<Worker | null>(null);
  const [trees, setTrees] = useState<ChangeTreeNode[]>([]);
  const [isComputing, setIsComputing] = useState(false);
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
      } else if (response.type === "error") {
        console.error("PatchSets worker error:", response.error);
        setIsComputing(false);
      }
    };

    worker.onerror = (event) => {
      console.error("PatchSets worker failed:", event.message);
      setIsComputing(false);
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

  useEffect(() => {
    compute(patchSets);
  }, [patchSets, compute]);

  return { trees, isComputing };
}
