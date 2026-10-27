import { ModuleFilePath } from "@valbuild/core";
import type { SourceStore } from "../stores/SourceStore";

/**
 * Load the `.jsonValues()` entry content a reference scan needs, and say
 * whether the scan can now be trusted.
 *
 * A rename moves a thing out from under everything pointing at it, and a scan
 * is blind to entry content that has not been loaded — so a rename on an
 * incomplete scan silently leaves referrers pointing at a name that no longer
 * exists. Every rename goes through here before it scans, so none of them can
 * write on the strength of a scan that could not see everything.
 *
 * `required` comes from `jsonValuesLoadRequirements`, which in the common case
 * is empty — and then this returns at once, having loaded nothing.
 */
export async function loadForReferenceScan(
  sourceStore: SourceStore,
  required: readonly ModuleFilePath[],
  /** What the unloaded content could do, for the message: "link to this page". */
  couldDo: string,
): Promise<{ status: "complete" } | { status: "error"; message: string }> {
  if (required.length === 0) {
    return { status: "complete" };
  }
  await Promise.all(
    required.map((moduleFilePath) =>
      sourceStore.loadAllEntries(moduleFilePath),
    ),
  );
  let status = sourceStore.entriesStatus(required);
  if (status.status === "error") {
    /*
     * One retry, because a failure is otherwise permanent.
     *
     * `loadAllEntries` records a failed entry and every later load SKIPS it -
     * deliberately, so that a broken entry is not a fetch loop. `retryEntry` is
     * the one door back in, so without this a single failed fetch would refuse
     * every rename in the project for the rest of the session, with nothing the
     * editor could do about it but reload the page.
     */
    await Promise.all(
      status.errors.map((failed) =>
        sourceStore.retryEntry(failed.moduleFilePath, failed.key),
      ),
    );
    status = sourceStore.entriesStatus(required);
  }
  if (status.status === "complete") {
    return { status: "complete" };
  }
  return {
    status: "error",
    message:
      status.status === "error"
        ? `Content that could ${couldDo} failed to load: ${status.errors[0]?.message ?? "unknown error"}`
        : `Content that could ${couldDo} could not be loaded.`,
  };
}
