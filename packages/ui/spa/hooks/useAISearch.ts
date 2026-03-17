import { useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type { WorkerRequest, WorkerResponse } from "../search/worker-types";
import type { SearchResult } from "../search/useSearchWorker";
import { useWsMessages, useSyncEngine } from "../components/ValProvider";

export function useAISearch() {
  const { sendWsMessage } = useWsMessages();
  const syncEngine = useSyncEngine();

  const schemas = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getAllSchemasSnapshot(),
    () => syncEngine.getAllSchemasSnapshot(),
  );
  const sources = useSyncExternalStore(
    syncEngine.subscribe("all-sources"),
    () => syncEngine.getAllSourcesSnapshot(),
    () => syncEngine.getAllSourcesSnapshot(),
  );

  const workerRef = useRef<Worker | null>(null);
  const isIndexBuiltRef = useRef(false);
  const requestIdCounter = useRef(0);
  const pendingRequests = useRef<
    Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >
  >(new Map());

  useEffect(() => {
    isIndexBuiltRef.current = false;
  }, [schemas, sources]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../search/search.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = pendingRequests.current.get(response.id);
      if (!pending) return;
      pendingRequests.current.delete(response.id);
      if (response.type === "index-ready") {
        isIndexBuiltRef.current = true;
        pending.resolve(null);
      } else if (response.type === "search-results") {
        pending.resolve(response.results);
      } else if (response.type === "error") {
        pending.reject(new Error(response.error));
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const query = useCallback(
    async (searchQuery: string, toolCallId: string) => {
      if (!workerRef.current) return;
      try {
        if (!isIndexBuiltRef.current) {
          const modules: Record<
            ModuleFilePath,
            { source: Json; schema: SerializedSchema }
          > = {};
          for (const path in schemas) {
            const moduleFilePath = path as ModuleFilePath;
            const source = sources?.[moduleFilePath];
            if (source !== undefined) {
              modules[moduleFilePath] = {
                source,
                schema: schemas[moduleFilePath],
              };
            }
          }
          const buildId = `ai-build-${requestIdCounter.current++}`;
          await new Promise((resolve, reject) => {
            pendingRequests.current.set(buildId, { resolve, reject });
            workerRef.current!.postMessage({
              type: "build-index",
              id: buildId,
              modules,
            } satisfies WorkerRequest);
          });
        }

        const results = await new Promise<SearchResult[]>((resolve, reject) => {
          pendingRequests.current.set(toolCallId, {
            resolve: resolve as (value: unknown) => void,
            reject,
          });
          workerRef.current!.postMessage({
            type: "search",
            id: toolCallId,
            query: searchQuery,
          } satisfies WorkerRequest);
        });

        console.log("Search results for query", searchQuery, results, {
          toolCallId,
        });
        sendWsMessage({ type: "ai_tool_result", toolCallId, result: results });
      } catch (error) {
        sendWsMessage({
          type: "ai_tool_result",
          toolCallId,
          result: String(error),
          isError: true,
        });
      }
    },
    [schemas, sources, sendWsMessage],
  );

  return { query };
}
