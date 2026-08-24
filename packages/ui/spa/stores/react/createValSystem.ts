import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import { createSystem, type System } from "../createSystem";
import type { PatchRecord } from "../types";

/**
 * A {@link System} wired to the real server, from a `ValClient`.
 *
 * The store layer takes every network path as a seam — `fetchPatches`,
 * `savePatches`, `uploadFile`, `fetchJsonEntry` — precisely so this file is the
 * only place that knows about HTTP. Everything else in `stores/` is tested
 * against in-memory implementations of these four functions.
 *
 * ## Read-only by default, and that is deliberate
 *
 * `savePatches` and `uploadFile` are omitted unless `writes` is set. A system
 * with no write seam records edits and reports them `pending` forever, which is
 * the honest behaviour for a SHADOW mount running beside the engine: two systems
 * both writing to one linear patch chain would conflict with each other on every
 * keystroke, and each would "resolve" it by re-sending. The engine owns writes
 * until it owns nothing.
 *
 * Passing `writes: true` is for when the engine is gone, not before.
 */
export function createValSystem(
  client: ValClient,
  options?: { writes?: boolean },
): System {
  return createSystem({
    fetchPatches: async (patchIds) => {
      const res = await client("/patches", "GET", {
        query: {
          exclude_patch_ops: false,
          // The ids we actually want, not the whole table. The engine asks for
          // everything because it keeps a whole-project map; this store is asked
          // for specific ids by `StatStore` and can say so.
          patch_id: patchIds,
        },
      });
      if (res.status !== 200) {
        const message =
          "message" in res.json
            ? res.json.message
            : `GET /patches failed with status ${res.status ?? "network"}`;
        return {
          patches: [],
          errors: Object.fromEntries(patchIds.map((id) => [id, message])),
        };
      }
      const patches: PatchRecord[] = [];
      const errors: Record<PatchId, string> = {};
      for (const patch of res.json.patches) {
        if (patch.patch === undefined) {
          // Announced by stat but the server has no ops for it. An error rather
          // than a silent skip: the head would otherwise stay `partial` forever
          // with nothing saying why.
          errors[patch.patchId] = `No ops for patch ${patch.patchId}`;
          continue;
        }
        patches.push({
          patchId: patch.patchId,
          moduleFilePath: patch.path,
          patch: patch.patch,
          createdAt: patch.createdAt,
          authorId: patch.authorId ?? undefined,
        });
      }
      return { patches, errors };
    },

    fetchJsonEntry: async (moduleFilePath, key) => {
      const res = await client("/json", "GET", {
        query: {
          path: moduleFilePath,
          key: undefined,
          keys: [key],
          offset: undefined,
          limit: undefined,
          // The store owns local patches and applies them itself. Letting the
          // server apply them too would double-apply — the same reason the engine
          // passes false here.
          apply_patches: false,
        },
      });
      if (res.status !== 200 || !("entries" in res.json)) {
        return {
          status: "error",
          message:
            res.status !== 200 && "message" in res.json
              ? res.json.message
              : `GET /json failed with status ${res.status ?? "network"}`,
        };
      }
      const entry = res.json.entries.find((candidate) => candidate.key === key);
      if (entry === undefined) {
        const failed = res.json.errors.find(
          (candidate) => candidate.key === key,
        );
        if (failed !== undefined) {
          return { status: "error", message: failed.message };
        }
        // In `missing`, or absent from the response altogether. Both mean the
        // server could not resolve a key we were told exists — deleted on disk
        // between the source sync and this request.
        return {
          status: "error",
          message: `Entry not found: ${key} in ${moduleFilePath}`,
        };
      }
      return { status: "ok", content: entry.content ?? null };
    },

    ...(options?.writes === true
      ? {
          savePatches: async ({ patches, parentRef, sessionId }) => {
            const res = await client("/patches", "PUT", {
              body: { patches, parentRef, sessionId },
            });
            if (res.status === null) {
              return {
                status: "network-error",
                message:
                  "message" in res.json ? res.json.message : "Network error",
              };
            }
            if (res.status === 409) {
              return { status: "conflict", message: res.json.message };
            }
            if (res.status === 400) {
              // 400 is the PERMANENT refusal, and mapping it to anything
              // retryable would retry a bad patch until the end of time. The
              // per-module errors are carried through so a UI can say which.
              return {
                status: "rejected",
                message: res.json.message,
                errors: Object.fromEntries(
                  Object.entries(res.json.errors ?? {}).map(
                    ([moduleFilePath, list]) => [
                      moduleFilePath as ModuleFilePath,
                      list.map((entry) => entry.error.message),
                    ],
                  ),
                ),
              };
            }
            if (res.status !== 200) {
              return {
                status: "unauthorized",
                message:
                  "message" in res.json
                    ? res.json.message
                    : `PUT /patches failed with status ${res.status}`,
              };
            }
            return {
              status: "saved",
              newPatchIds: res.json.newPatchIds,
              parentRef: res.json.parentRef,
            };
          },
        }
      : {}),
  });
}
