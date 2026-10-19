import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import type { Evaluated } from "@valbuild/shared/internal";
import { readValModules } from "./readValModules";

/**
 * One tree's Val modules, evaluated off the Studio's page: the bundle
 * `bundleValModules` made, imported from a `blob:` URL, and read
 * (`readValModules`). A worker because the bundle runs the site's own
 * `@valbuild/*` -- `@valbuild/tanstack` brings React and patches its JSX --
 * and a worker per tree (`evaluateTree.ts`), so no tree's modules or globals
 * are another's.
 */

export type EvaluateRequest = {
  code: string;
  /** The content whose errors to report, by module; absent: the text's. */
  sources: Record<string, JSONValue | null>;
};
export type EvaluateReply =
  | { ok: true; evaluated: Evaluated }
  | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<EvaluateRequest>) => {
  const { code, sources } = event.data;
  const url = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" }),
  );
  let reply: EvaluateReply;
  try {
    const entry: unknown = await import(/* @vite-ignore */ url);
    reply = {
      ok: true,
      evaluated: await readValModules(
        entry,
        (path: ModuleFilePath) => sources[path] ?? null,
      ),
    };
  } catch (error) {
    reply = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
  self.postMessage(reply);
};
