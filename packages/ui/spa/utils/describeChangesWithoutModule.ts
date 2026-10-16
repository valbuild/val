import type { ModuleFilePath, PatchId } from "@valbuild/core";

/**
 * What to tell an editor about unpublished changes to files the project no
 * longer has.
 *
 * A `.val` file renamed or deleted with unpublished changes leaves them behind.
 * They cannot be shown and they cannot be published, and only the editor can
 * say whether the file is coming back, so the message names the files and the
 * action next to it is Discard.
 *
 * Pure, so the wording is checkable without a browser.
 */
export function describeChangesWithoutModule(
  changes: readonly { patchId: PatchId; moduleFilePath: ModuleFilePath }[],
): { title: string; description: string } | null {
  if (changes.length === 0) return null;
  const files = [...new Set(changes.map((change) => change.moduleFilePath))];
  const count = changes.length;
  const title =
    count === 1
      ? "An unpublished change is to a file that is not in the project"
      : `${count} unpublished changes are to files that are not in the project`;
  const named =
    files.length <= 3
      ? files.join(", ")
      : `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`;
  /*
   * "Renamed or deleted" is the usual story, not the only one: a module whose
   * import throws (a syntax error mid-edit) is missing from intake too, and the
   * dev banner names it. So the fix for that case is said as well -- Discard
   * would throw away an edit that only needs the file to load again.
   */
  const one = files.length === 1;
  return {
    title,
    description:
      `${named} ${one ? "is" : "are"} not among the project's modules. ` +
      `If ${one ? "it was" : "they were"} renamed or deleted, discard ` +
      `${count === 1 ? "the change" : "them"} to publish the rest. If ` +
      `${one ? "it is" : "they are"} back, or only failed to load, ` +
      `${count === 1 ? "the change applies" : "they apply"} again.`,
  };
}
