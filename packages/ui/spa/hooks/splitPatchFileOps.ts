import { Internal } from "@valbuild/core";
import type { FileOperation, Operation } from "@valbuild/core/patch";
import type { Patch } from "@valbuild/shared/internal";

const textEncoder = new TextEncoder();

export type SplitPatch = {
  /**
   * The ops to send as the patch. Every `file` op's `value` is a HASH of the
   * data, never the data.
   */
  patchOps: Operation[];
  /**
   * The `file` ops with their data intact, to upload one by one BEFORE the
   * patch is sent.
   */
  fileOps: FileOperation[];
};

/**
 * Split a patch into the ops to send and the files to upload first.
 *
 * ## The rule this exists to enforce
 *
 * A patch that reaches the server must never carry binary data. Files are
 * uploaded directly from the client — `POST {baseUrl}/patches/{patchId}/files`
 * in FS mode, straight to the content host in HTTP mode — and the `file` op left
 * in the patch carries only the SHA-256 of what was uploaded.
 *
 * Why it matters more than "the patch is smaller": the server never reads a
 * `file` op's value as data. `ValOps` checks it for null, to decide whether to
 * stamp `patch_id` onto the file source; the binary itself is only ever read back
 * from the uploaded file. So base64 left in a `file` op is not a slower route to
 * the same result — it is dead weight that produces NO file, and the failure is
 * silent: the patch applies, the source points at a path, and nothing is there.
 *
 * That is why the hash is not decoration either. It is the only thing in the
 * patch that says WHICH bytes this op meant, so an upload that never happened,
 * or happened with different bytes, is at least detectable rather than
 * indistinguishable from success.
 *
 * ## What is left alone
 *
 * - `value: null` — a DELETE. There is nothing to upload and nothing to hash,
 *   and turning it into a hash of `"null"` would make a removal look like an
 *   addition of a file whose bytes are the four characters `null`.
 * - a non-string value — already not data. Hashing it would corrupt whatever it
 *   is.
 *
 * Both are returned in `fileOps` regardless: the caller decides what a `file` op
 * with no data means for the upload step (for a delete, nothing), and dropping
 * them here would hide the op from that decision.
 */
export function splitPatchFileOps(patch: Patch): SplitPatch {
  const fileOps: FileOperation[] = [];
  const patchOps: Operation[] = [];
  for (const op of patch) {
    if (op.op === "file") {
      fileOps.push(op);
      patchOps.push({
        ...op,
        value:
          typeof op.value === "string"
            ? Internal.getSHA256Hash(textEncoder.encode(op.value))
            : op.value,
      });
    } else {
      patchOps.push(op);
    }
  }
  return { patchOps, fileOps };
}

/**
 * Does this patch still carry binary data?
 *
 * A guard for the boundary rather than a step in it: anything about to be sent as
 * a patch can be checked, and a `true` here is a bug in the caller — it means a
 * file op skipped {@link splitPatchFileOps} and its bytes are about to be written
 * into the patch chain, where they will be stored, replayed, and never used.
 */
export function hasUnuploadedFileData(patch: Patch): boolean {
  for (const op of patch) {
    if (op.op !== "file") continue;
    if (typeof op.value !== "string") continue;
    // A data URL is the shape every producer in the client uses (`FileReader`),
    // and a hash cannot contain a comma, so this cannot false-positive on one.
    if (op.value.startsWith("data:")) return true;
  }
  return false;
}
