import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import { createSystem, type System } from "../createSystem";
import type { SchemaValidationBridge } from "../bridges";
import { createSchemaValidationBridge } from "../../validation/schemaValidationBridge";
import type { PatchRecord } from "../types";
import { chunkPatchIds } from "./patchIdChunks";

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
 * the honest behaviour for one that cannot write — a benchmark, a test of the
 * read path, a preview. It is deliberately not a silent success: an edit that
 * reports itself saved when nothing was written is the worst outcome available.
 *
 * The Studio passes `writes: true`. There is exactly one writer, which is what
 * the server's single linear patch chain requires: it checks every `parentRef`,
 * so two systems both writing would 409 on every keystroke and each would
 * "resolve" it by re-sending.
 */
/**
 * Where a patch's file bytes are POSTed, and with what credentials.
 *
 * Fetched per upload rather than once, because the nonce is short-lived and the
 * base URL differs between FS mode (`/api/val/upload`) and a content host. The
 * app already has this as `getDirectFileUploadSettings`; it is passed in rather
 * than re-derived so there is one implementation of "where do files go".
 */
export type UploadSettings = () => Promise<
  | {
      status: "success";
      data: {
        nonce: string | null;
        baseUrl: string;
        contentBaseUrl: string | null;
        contentAuthNonce: string | null;
      };
    }
  | { status: "error"; error: string }
>;

export function createValSystem(
  client: ValClient,
  options?: {
    writes?: boolean;
    uploadSettings?: UploadSettings;
    /** Whether a publish leaves the patches on the server. See `SystemOptions`. */
    mode?: "fs" | "http";
    /**
     * Where schema validation runs. Defaults to a real worker.
     *
     * Overridable so a test can validate in-process: `new Worker(new
     * URL(..., import.meta.url))` is a Vite construct with no meaning under
     * jest, and a test that had to stub `Worker` would be testing the stub.
     */
    schemaValidation?: SchemaValidationBridge;
  },
): System {
  return createSystem({
    /**
     * Schema validation, on a thread.
     *
     * Not the in-process default `createSystem` falls back to: validating a
     * module walks its whole source against its whole schema, and the Studio
     * validates the module the user is typing into. On the main thread that is
     * exactly the blocking this architecture exists to remove — measured at
     * 43.7ms of never-yielding main thread for one reindex-sized walk.
     */
    schemaValidation:
      options?.schemaValidation ?? createSchemaValidationBridge(),
    ...(options?.uploadSettings !== undefined
      ? {
          /**
           * The real thing: POST one file's bytes to wherever files live.
           *
           * `POST {baseUrl}/patches/{patchId}/files` with a JSON body, which is
           * the protocol `ValFieldProvider.uploadPatchFile` already speaks — the
           * bytes travel as a base64 data URL in `data`, not as multipart.
           *
           * `XMLHttpRequest`, not `fetch`, and only for one reason: `fetch` cannot
           * report upload progress. An image is the one thing here slow enough
           * that a user needs to see it moving, so the seam carries an
           * `onProgress` and this is what fills it.
           *
           * A remote ref is split back to its file path, because the server keys
           * files by path and a remote ref is a URL that encodes one.
           */
          uploadFile: async ({
            patchId,
            parentRef,
            filePath,
            data,
            type,
            remote,
            metadata,
            onProgress,
          }) => {
            const settings = await options.uploadSettings!();
            if (settings.status === "error") {
              return {
                status: "error",
                message: `Could not find where to upload files: ${settings.error}`,
              };
            }
            let target = filePath;
            if (remote) {
              const split = Internal.remote.splitRemoteRef(filePath);
              if (split.status === "error") {
                return {
                  status: "error",
                  message: `Could not read the file path out of a remote ref (${split.error}). This is most likely a Val bug.`,
                };
              }
              target = "/" + split.filePath;
            }
            const body = JSON.stringify({
              filePath: target,
              /**
               * The REAL parent of the patch these bytes belong to.
               *
               * Not decoration. `ValOpsFS` writes a patch's files into the
               * directory named by its parentRef and reads them back out of the
               * directory the PATCH ended up in — so if the two disagree the
               * bytes sit on disk and the image 404s. This was hardcoded to
               * `head`, which is right only while the chain is empty; after the
               * first patch every image upload landed in the wrong directory.
               *
               * `null` means nothing has established a parent yet, which is the
               * head. (`ValOpsHttp` ignores parentRef entirely — its files are
               * keyed by patch id — so this matters in `fs` mode.)
               */
              parentRef: parentRef ?? { type: "head", headBaseSha: "" },
              data,
              type,
              metadata,
              remote,
            });
            return new Promise((resolve) => {
              const xhr = new XMLHttpRequest();
              if (onProgress !== undefined) {
                xhr.upload.addEventListener("progress", (event) => {
                  if (event.lengthComputable) {
                    onProgress(event.loaded, event.total);
                  }
                });
              }
              xhr.addEventListener("load", () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve({ status: "ok" });
                  return;
                }
                resolve({
                  status: "error",
                  message: `Could not upload ${target}: HTTP ${xhr.status} ${xhr.statusText}`,
                });
              });
              xhr.addEventListener("error", () => {
                resolve({
                  status: "error",
                  message: `Could not upload ${target} (network error?)`,
                });
              });
              xhr.responseType = "text";
              xhr.open(
                "POST",
                `${settings.data.baseUrl}/patches/${patchId}/files`,
              );
              xhr.setRequestHeader("Content-Type", "application/json");
              if (settings.data.nonce !== null) {
                xhr.setRequestHeader("x-val-auth-nonce", settings.data.nonce);
              }
              xhr.send(body);
            });
          },
        }
      : {}),
    fetchPatches: async (patchIds) => {
      const patches: PatchRecord[] = [];
      const errors: Record<PatchId, string> = {};
      // In batches whose query strings fit. All the ids on one URL is ~19KB at
      // 410 pending changes, which a Node server rejects before the handler runs.
      for (const chunk of chunkPatchIds(patchIds)) {
        const res = await client("/patches", "GET", {
          query: {
            exclude_patch_ops: false,
            // The ids we actually want, not the whole table. The engine asks for
            // everything because it keeps a whole-project map; this store is asked
            // for specific ids by `StatStore` and can say so.
            patch_id: chunk,
          },
        });
        if (res.status !== 200) {
          const message =
            "message" in res.json
              ? res.json.message
              : `GET /patches failed with status ${res.status ?? "network"}`;
          // Only this chunk. A later one may well succeed, and failing the whole
          // request would throw away patches that did arrive.
          for (const patchId of chunk) {
            errors[patchId] = message;
          }
          continue;
        }
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
            appliedAt: patch.appliedAt ?? null,
          });
        }
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

    mode: options?.mode,

    /**
     * `POST /save`.
     *
     * The three failure shapes are kept apart because they demand different
     * things. A 409 is someone else committing first — retry once caught up. A
     * 400 names the patches that cannot be applied, and carrying them per id is
     * the only way a TS-AST-only failure ever reaches an editor: the client
     * applies patches to evaluated JSON and cannot see those at all.
     */
    publishPatches: async ({ patchIds, message }) => {
      const res = await client("/save", "POST", {
        body: { message, patchIds },
      });
      if (res.status === null) {
        return {
          status: "network-error",
          message: "message" in res.json ? res.json.message : "Network error",
        };
      }
      if (res.status === 200) {
        return { status: "published" };
      }
      if (res.status === 409) {
        return { status: "not-fast-forward", message: res.json.message };
      }
      if (res.status === 400) {
        const errors: Record<PatchId, string> = {};
        const details = "details" in res.json ? res.json.details : undefined;
        if (Array.isArray(details)) {
          for (const detail of details) {
            if (
              typeof detail === "object" &&
              detail !== null &&
              "patchId" in detail &&
              "message" in detail
            ) {
              errors[detail.patchId as PatchId] = String(detail.message);
            }
          }
        }
        return { status: "patch-errors", message: res.json.message, errors };
      }
      return {
        status: "error",
        message:
          "message" in res.json
            ? res.json.message
            : `POST /save failed with status ${res.status}`,
      };
    },

    discardPatches: async (patchIds) => {
      const res = await client("/patches", "DELETE", {
        query: { id: patchIds },
      });
      if (res.status !== 200) {
        return {
          status: "error",
          message:
            res.status !== null && "message" in res.json
              ? res.json.message
              : `DELETE /patches failed with status ${res.status ?? "network"}`,
        };
      }
      // The ids the server says it deleted. A partial delete must not make the
      // client forget a patch that still exists.
      return { status: "discarded", patchIds: res.json };
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
