import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { Internal } from "@valbuild/core";
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
    mirror?: boolean;
    uploadSettings?: UploadSettings;
  },
): System {
  return createSystem({
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
              // Required by the endpoint, and about the PATCH — which does not
              // exist yet, because the bytes go first by design so a patch can
              // never reference a file that is not there. The server uses it for
              // authorisation rather than ordering, and the patch that follows
              // carries the real one.
              parentRef: { type: "head", headBaseSha: "" },
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
      : options?.mirror === true
        ? {
            /**
             * The MIRROR upload seam: accept the patch, upload nothing.
             *
             * Only for a shadow system being fed the engine's patches. Without a
             * upload seam at all, `PatchStore.createPatch` REFUSES any patch
             * carrying file ops — correctly, because silently dropping bytes is the
             * failure that seam exists to prevent. But in a mirror that refusal is
             * the wrong outcome: the engine has already uploaded these exact bytes
             * to this exact path, so the file genuinely is on the server, and
             * refusing the patch would leave the shadow's source diverging from the
             * engine's for every image edit — which is precisely what a shadow
             * exists to detect, so it must not manufacture it.
             *
             * Uploading again would be worse: the same bytes POSTed twice per edit.
             *
             * So it reports ok and does nothing, and the comment is the whole
             * justification: the upload happened, just not by this system.
             */
            uploadFile: async () => ({ status: "ok" }),
          }
        : {}),
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
