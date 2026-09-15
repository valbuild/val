import { ModuleFilePath } from "@valbuild/core";
import type { SourceStore } from "../stores/SourceStore";

/**
 * Load a `.jsonValues()` entry's content, and establish that it is really there.
 *
 * For the writes that move an entry's VALUE rather than read it - a `copy`, a
 * `move` - because until the content is loaded the entry is an opaque marker and
 * that is what they would carry: the copy or the renamed page then opens on a
 * `/json?key=<newKey>` the base source has no entry for, which 404s. Nothing on
 * screen says so, which is what makes it worth a function of its own.
 *
 * ## Awaiting the load is not the same as having it
 *
 * `loadEntries` resolves either way: a fetch that fails is RECORDED
 * (`entryFailures`) rather than thrown, and a key that has failed before is
 * skipped entirely - so the await can return immediately with the marker still
 * in place. The answer has to come from asking whether the entry arrived, which
 * is `entryError`.
 *
 * ## And one retry, because a recorded failure is otherwise permanent
 *
 * That skip is deliberate - a broken entry must not become a fetch loop - and
 * `retryEntry` is the one door back in. Without it a single failed fetch would
 * refuse every duplicate and rename of that entry for the rest of the session,
 * with nothing the editor could do about it but reload the Studio.
 */
export async function loadEntryContent(
  sourceStore: SourceStore,
  moduleFilePath: ModuleFilePath,
  key: string,
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  await sourceStore.loadEntries(moduleFilePath, [key]);
  if (sourceStore.entryError(moduleFilePath, key) === undefined) {
    return { status: "ok" };
  }
  return sourceStore.retryEntry(moduleFilePath, key);
}
