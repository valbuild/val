/// <reference lib="webworker" />
import type {
  ValidationWorkerRequest,
  ValidationWorkerResponse,
} from "./worker-types";
import { SchemaValidator } from "./validateModule";
import { collectCustomValidateTargets } from "./customValidate";

const ctx: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

const validator = new SchemaValidator();

ctx.onmessage = (event: MessageEvent<ValidationWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "validate") return;
  try {
    const errors = validator.validate(
      request.moduleFilePath,
      request.source,
      request.serializedSchema,
      request.schemaSha,
    );
    // Off the main thread while we already have the module in hand. The main
    // thread only EXECUTES the paths this finds.
    const customValidate = request.collectCustomValidate
      ? collectCustomValidateTargets(
          request.moduleFilePath,
          request.serializedSchema,
          request.source,
        )
      : undefined;
    const response: ValidationWorkerResponse = {
      type: "result",
      id: request.id,
      moduleFilePath: request.moduleFilePath,
      schemaSha: request.schemaSha,
      errors,
      customValidatePaths: customValidate?.paths,
      customValidateNeedsJsonKeys: customValidate?.needsJsonKeys,
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
