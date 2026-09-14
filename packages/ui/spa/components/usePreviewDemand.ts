import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useEffect, useId } from "react";
import { useValSystem } from "../stores/react/SystemContext";

/**
 * Ask for these modules to be previewed, for a view that shows many of them.
 *
 * A preview is computed for a module that has a LISTENER on it, and for no
 * other — that is the demand signal the whole store is built around, and a
 * caller invoking `get()` deliberately does not count (see `PreviewStore`).
 * Every field on screen registers one by mounting, which is what makes an open
 * editor's previews appear.
 *
 * A NAV does not. It reads module paths out of the tree and sources out of the
 * store without subscribing — `useShallowModulesAtPaths` says so in a comment,
 * because one subscription per module would be one wake per module per
 * keystroke. So a nav that wants to NAME its rows has nothing computing those
 * names, and the titles appear only for whichever module the editor happens to
 * be in. That is worse than showing none: a list where some rows are named and
 * some are not reads as data missing rather than as a feature not used.
 *
 * One listener per module, registered once, is the smallest thing that fixes
 * it — the store coalesces from there, and only the FIRST listener on a module
 * triggers a preview. Deliberately not per row: a router module with eight
 * hundred pages is one listener, and its rows all come out of the one reified
 * answer.
 *
 * Pass only the modules that can actually produce something. A module whose
 * schema declares no preview costs a load for an answer that is always empty,
 * and `SerializedSchema.preview` says which those are without loading anything.
 */
export function usePreviewDemand(moduleFilePaths: readonly ModuleFilePath[]) {
  const val = useValSystem();
  const ownId = useId();
  /*
   * The effect depends on the CONTENT of the list, not on the array's identity.
   * A caller building it inline would otherwise unregister and re-register
   * every render — which is a preview per render on a store whose entire design
   * is about not doing that.
   */
  const key = moduleFilePaths.join(" ");
  useEffect(() => {
    if (val === null || key === "") {
      return;
    }
    const offs = key
      .split(" ")
      .map((moduleFilePath) =>
        val.system.sourceStore.addListener(
          moduleFilePath as unknown as SourcePath,
          ownId,
          () => {},
        ),
      );
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [val, key, ownId]);
}
