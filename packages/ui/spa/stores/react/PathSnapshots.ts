import type { SourcePath } from "@valbuild/core";
import type { SourcePeek } from "../SourceStore";
import type { SourceStore } from "../SourceStore";

/**
 * `peek`, made reference-stable for `useSyncExternalStore`.
 *
 * React requires `getSnapshot` to return the same reference until the value
 * actually changes — otherwise it warns "the result of getSnapshot should be
 * cached" and, for an object-valued path, re-renders on every call. `peek` builds
 * a fresh result object per call, so something has to hold the last one.
 *
 * This is NOT a read cache. `peek` is cheap and is called every time; all this
 * does is decide whether the answer is the same answer, and hand back the
 * previous object when it is.
 *
 * ## What "the same answer" means
 *
 * The value is compared by IDENTITY, which is exact for the case that matters:
 * `peek` returns a reference into the store's own source, so an unchanged value
 * is the same object, and an unchanged primitive is `===` regardless.
 *
 * **The known imprecision**, recorded because it is real: `applyPatch` clones the
 * module it patches, so after an edit to a SIBLING field, an object-valued path
 * in the same module resolves to a new object that is structurally identical to
 * the old one. This will report it as changed. It cannot cause a wrong render —
 * the value is right either way — but it can cause one extra render of an
 * object-valued field whose contents did not move. Fixing it needs either
 * structural sharing in the apply or a content hash per path, and neither is
 * worth doing before something measures it.
 */
export class PathSnapshots {
  private held = new Map<SourcePath, SourcePeek>();

  get(store: SourceStore, path: SourcePath): SourcePeek {
    const next = store.peek(path);
    const previous = this.held.get(path);
    if (previous !== undefined && same(previous, next)) {
      return previous;
    }
    this.held.set(path, next);
    return next;
  }

  /** Drop a path nothing is watching any more. */
  forget(path: SourcePath): void {
    this.held.delete(path);
  }
}

function same(a: SourcePeek, b: SourcePeek): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "ready" && b.status === "ready") {
    // Identity, not deep equality: see the note above on why this is exact for
    // an unchanged value and conservative after a sibling edit.
    return a.data === b.data && a.revision.n === b.revision.n;
  }
  if (a.status === "absent" && b.status === "absent") {
    return a.revision.n === b.revision.n;
  }
  if (a.status === "entry-failed" && b.status === "entry-failed") {
    return a.key === b.key && a.message === b.message;
  }
  if (
    (a.status === "entry-missing" && b.status === "entry-missing") ||
    (a.status === "entry-loading" && b.status === "entry-loading")
  ) {
    return a.key === b.key;
  }
  // `module-loading` carries nothing, so two of them are the same answer.
  return a.status === "module-loading";
}
