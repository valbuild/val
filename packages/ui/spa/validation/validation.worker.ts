/// <reference lib="webworker" />
import {
  deserializeSchema,
  ModuleFilePath,
  Schema,
  SelectorSource,
  SourcePath,
} from "@valbuild/core";
import type {
  ValidationWorkerRequest,
  ValidationWorkerResponse,
} from "./worker-types";

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

const schemaCache = new Map<
  ModuleFilePath,
  { schemaSha: string; schema: Schema<SelectorSource> }
>();

ctx.onmessage = (event: MessageEvent<ValidationWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "validate") return;
  try {
    let cached = schemaCache.get(request.moduleFilePath);
    if (!cached || cached.schemaSha !== request.schemaSha) {
      cached = {
        schemaSha: request.schemaSha,
        schema: deserializeSchema(request.serializedSchema),
      };
      schemaCache.set(request.moduleFilePath, cached);
    }
    const errors = cached.schema["executeValidate"](
      request.moduleFilePath as string as SourcePath,
      request.source as SelectorSource,
    );
    const response: ValidationWorkerResponse = {
      type: "result",
      id: request.id,
      moduleFilePath: request.moduleFilePath,
      schemaSha: request.schemaSha,
      errors,
    };
    ctx.postMessage(response);
  } catch (error) {
    const response: ValidationWorkerResponse = {
      type: "error",
      id: request.id,
      moduleFilePath: request.moduleFilePath,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
