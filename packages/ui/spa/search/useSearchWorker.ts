import { useEffect, useRef, useState, useCallback } from "react";
import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import type { WorkerRequest, WorkerResponse } from "./worker-types";

export interface SearchResult {
  path: SourcePath;
  label: string;
}

export interface UseSearchWorkerReturn {
  buildIndex: (
    modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
  ) => void;
  search: (query: string, limit?: number) => void;
  results: SearchResult[];
  pathToLabel: Map<string, string>;
  isIndexing: boolean;
  isSearching: boolean;
  error: string | null;
}

export function useSearchWorker(): UseSearchWorkerReturn {
  const workerRef = useRef<Worker | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pathToLabel, setPathToLabel] = useState<Map<string, string>>(
    new Map(),
  );
  const [isIndexing, setIsIndexing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep track of request IDs and their callbacks
  const requestIdCounter = useRef(0);
  const pendingRequests = useRef<
    Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >
  >(new Map());

  // Initialize worker
  useEffect(() => {
    // Use new Worker with import.meta.url for better compatibility
    const worker = new Worker(new URL("./search.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    // Handle messages from worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.type === "index-ready") {
        setIsIndexing(false);
        // Convert array back to Map
        setPathToLabel(new Map(response.pathToLabel));
        const pending = pendingRequests.current.get(response.id);
        if (pending) {
          pending.resolve(response.pathToLabel);
          pendingRequests.current.delete(response.id);
        }
      } else if (response.type === "search-results") {
        setIsSearching(false);
        setResults(response.results);
        const pending = pendingRequests.current.get(response.id);
        if (pending) {
          pending.resolve(response.results);
          pendingRequests.current.delete(response.id);
        }
      } else if (response.type === "error") {
        setIsIndexing(false);
        setIsSearching(false);
        setError(response.error);
        const pending = pendingRequests.current.get(response.id);
        if (pending) {
          pending.reject(new Error(response.error));
          pendingRequests.current.delete(response.id);
        }
      }
    };

    worker.onerror = (event) => {
      setIsIndexing(false);
      setIsSearching(false);
      setError(event.message || "Worker error");
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const buildIndex = useCallback(
    (
      modules: Record<
        ModuleFilePath,
        { source: Json; schema: SerializedSchema }
      >,
    ) => {
      if (!workerRef.current) return;

      const id = `build-${requestIdCounter.current++}`;
      setIsIndexing(true);
      setError(null);

      const request: WorkerRequest = {
        type: "build-index",
        id,
        modules,
      };

      workerRef.current.postMessage(request);
    },
    [],
  );

  const search = useCallback((query: string, limit = 10) => {
    if (!workerRef.current) return;

    const id = `search-${requestIdCounter.current++}`;
    setIsSearching(true);
    setError(null);

    // Clear results immediately if query is empty
    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const request: WorkerRequest = {
      type: "search",
      id,
      query,
      limit,
    };

    workerRef.current.postMessage(request);
  }, []);

  return {
    buildIndex,
    search,
    results,
    pathToLabel,
    isIndexing,
    isSearching,
    error,
  };
}
