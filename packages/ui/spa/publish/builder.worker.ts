import type {
  BuilderCall,
  BuilderReply,
  BuilderRequest,
  BuilderResult,
} from "./builderProtocol";
import { importBuilderModule } from "./loadBuilder";

/**
 * The Studio's builder, in a worker.
 *
 * Rolldown's browser build runs threaded wasm whose threads share memory, and
 * when the thread calling into it has to wait for one of them it BLOCKS -- an
 * atomic wait. A page's main thread is not allowed to: Chromium throws
 * "Atomics.wait cannot be called in this context", WebKit reports an
 * out-of-bounds memory access, and either way the promise the build was
 * awaiting never settles. It depends on timing, so a publish hung at
 * "Building" some of the time, in every browser. Measured: 400 modules with
 * async plugin hooks hung on the main thread on the first or second build in
 * both engines, and built 40 times out of 40 in a worker, where waiting is
 * allowed.
 *
 * The import goes through `loadBuilder.ts`, which stays the one place the
 * package is loaded from (`onlyBuilderRoot.test.ts`).
 */

const reply = (message: BuilderReply) => self.postMessage(message);

let builder: Awaited<ReturnType<typeof importBuilderModule>> | null = null;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

self.onmessage = async (event: MessageEvent<BuilderRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    if (request.wasmUrl !== null) {
      // Read by rolldown's loader when it is evaluated, which is the import below.
      Reflect.set(globalThis, "__VAL_ROLLDOWN_WASM_URL__", request.wasmUrl);
    }
    try {
      builder = await importBuilderModule();
      reply({ type: "ready" });
    } catch (error) {
      reply({ type: "load-failed", message: messageOf(error) });
    }
    return;
  }
  const loaded = builder;
  if (loaded === null) {
    reply({
      type: "error",
      id: request.id,
      message: "The builder is not loaded.",
    });
    return;
  }
  try {
    reply({ type: "result", id: request.id, ...(await call(loaded, request)) });
  } catch (error) {
    reply({ type: "error", id: request.id, message: messageOf(error) });
  }
};

/** One method, by name, with the arguments it was sent. */
async function call(
  loaded: NonNullable<typeof builder>,
  request: BuilderCall,
): Promise<BuilderResult> {
  switch (request.method) {
    case "bakedGit":
      return { method: "bakedGit", value: loaded.bakedGit(...request.args) };
    case "rebakeGit":
      return { method: "rebakeGit", value: loaded.rebakeGit(...request.args) };
    case "buildUserApp":
      return {
        method: "buildUserApp",
        value: await loaded.buildUserApp(...request.args),
      };
    case "publishArtifacts":
      return {
        method: "publishArtifacts",
        value: await loaded.publishArtifacts(...request.args),
      };
  }
}
