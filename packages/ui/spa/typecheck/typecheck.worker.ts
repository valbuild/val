import {
  SourceError,
  adeptSources,
  LockfileError,
  UnsupportedLayoutError,
  typecheckProject,
} from "@valbuild/shared/typecheck";
import type {
  TypecheckFailure,
  TypecheckReply,
  TypecheckRequest,
} from "./typecheckProtocol";

/**
 * The Studio's typecheck, in a worker: a whole project's TypeScript program
 * takes seconds of CPU and hundreds of megabytes, which the page's thread
 * should not spend. See `typecheckProject.ts` for what it does.
 */

const reply = (message: TypecheckReply) => self.postMessage(message);

function failureOf(error: unknown): TypecheckFailure {
  if (error instanceof SourceError) {
    return {
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      status: error.status,
    };
  }
  // A lockfile or a workspace setting this cannot read: the same project
  // gets the same answer.
  if (
    error instanceof LockfileError ||
    error instanceof UnsupportedLayoutError
  ) {
    return {
      message: error.message,
      code: "unsupported-project",
      retryable: false,
      status: null,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: "typecheck-failed",
    retryable: false,
    status: null,
  };
}

self.onmessage = async (event: MessageEvent<TypecheckRequest>) => {
  const request = event.data;
  try {
    const result = await typecheckProject({
      files: request.files,
      lockfile: request.lockfile,
      workspace: request.workspace,
      sources: adeptSources({ base: request.base }),
      onProgress: (progress) =>
        reply({ type: "progress", id: request.id, progress }),
    });
    reply({ type: "result", id: request.id, result });
  } catch (error) {
    reply({ type: "error", id: request.id, failure: failureOf(error) });
  }
};
