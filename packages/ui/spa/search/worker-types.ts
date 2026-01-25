import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";

// Messages sent from main thread to worker
export type WorkerRequest =
  | {
      type: "build-index";
      id: string;
      modules: Record<
        ModuleFilePath,
        { source: Json; schema: SerializedSchema }
      >;
    }
  | {
      type: "search";
      id: string;
      query: string;
      limit?: number;
    };

// Messages sent from worker to main thread
export type WorkerResponse =
  | {
      type: "index-ready";
      id: string;
      pathToLabel: Array<[string, string]>; // Serialized Map
    }
  | {
      type: "search-results";
      id: string;
      results: Array<{ path: SourcePath; label: string }>;
    }
  | {
      type: "error";
      id: string;
      error: string;
    };
