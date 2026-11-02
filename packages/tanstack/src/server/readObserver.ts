import type { ModuleFilePath } from "@valbuild/core";
import type { ModuleVersion } from "@valbuild/shared/internal";

/**
 * What a server-side reader read, module by module: which source answered
 * and, where that source carries one, the version of what it answered.
 *
 * Not exported from the package. It is how the scenario world
 * (`scenarios/`) records the version beside the value a loader shows
 * (`docs/plans/one-content-model.md`, phase 1), until the readers resolve
 * through `resolveVal` and return their versions themselves (phase 3), when
 * this goes. Nothing in the product reads it, and with no observer the cost
 * of a read is one comparison with `null`.
 */
export type ModuleRead = {
  moduleFilePath: ModuleFilePath;
  /**
   * `server-draft`: Val's server, with the draft applied (its answer carries
   * the version). `snapshot`: a content version or a proposal's saves.
   * `bundle`: the build's own modules.
   */
  from: "server-draft" | "snapshot" | "bundle";
  /** As the source answered it; `null` for a source that carries none yet. */
  version: ModuleVersion | null;
};

type ReadObserver = (reads: readonly ModuleRead[]) => void;

let observer: ReadObserver | null = null;

/** Watch every read; answers how to stop. One observer at a time. */
export function observeModuleReads(next: ReadObserver): () => void {
  observer = next;
  return () => {
    if (observer === next) observer = null;
  };
}

/** Called by the readers; `reads` is built only when someone is watching. */
export function reportModuleReads(reads: () => readonly ModuleRead[]): void {
  if (observer !== null) observer(reads());
}
