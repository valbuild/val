import { buildSearchIndex, searchIndex, SearchIndex } from "./searchIndex";
import type { WorkerRequest, WorkerResponse } from "./worker-types";

let index: SearchIndex | null = null;

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "build-index") {
      index = buildSearchIndex(request.modules);

      // Send back the pathToLabel map as an array for serialization
      const response: WorkerResponse = {
        type: "index-ready",
        id: request.id,
        pathToLabel: Array.from(index.pathToLabel.entries()),
      };
      self.postMessage(response);
    } else if (request.type === "search") {
      const { results, total } = searchIndex(
        index,
        request.query,
        request.limit,
        request.offset,
      );
      const response: WorkerResponse = {
        type: "search-results",
        id: request.id,
        results,
        total,
      };
      self.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
