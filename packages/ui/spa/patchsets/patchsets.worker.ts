import { computeChangedSourcePaths } from "../utils/computeChangedSourcePaths";
import type {
  PatchSetsWorkerRequest,
  PatchSetsWorkerResponse,
} from "./worker-types";

self.onmessage = (event: MessageEvent<PatchSetsWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "compute") {
      const { trees } = computeChangedSourcePaths(request.patchSets);
      const response: PatchSetsWorkerResponse = {
        type: "result",
        id: request.id,
        trees,
      };
      self.postMessage(response);
    }
  } catch (error) {
    const response: PatchSetsWorkerResponse = {
      type: "error",
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
