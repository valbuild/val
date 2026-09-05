import type { PatchId } from "@valbuild/core";
import type { HistoryError } from "./HistoryError";

/**
 * Versions of @valbuild/core whose recorded ops cannot be replayed reliably.
 *
 * Empty, and hopefully stays that way. It exists because the failure it guards
 * against is silent: ops from a version whose semantics later changed still
 * APPLY, they just produce a source that is not what the author saw. A wrong
 * answer that looks right is worse than a refusal, so a known-bad version is
 * reported as its own kind of failure rather than replayed and hoped for.
 *
 * Add an exact version string here when one is found, with a comment saying
 * what it got wrong.
 */
export const KNOWN_BAD_CORE_VERSIONS: ReadonlySet<string> = new Set<string>([]);

export function checkCoreVersion(
  patchId: PatchId,
  coreVersion: string,
): HistoryError | null {
  if (KNOWN_BAD_CORE_VERSIONS.has(coreVersion)) {
    return { kind: "unsupported-core-version", patchId, coreVersion };
  }
  return null;
}
