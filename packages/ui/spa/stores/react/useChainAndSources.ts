import { useCallback } from "react";
import type { ValSystem } from "./SystemContext";

/**
 * Both the chain and the sources, as one thing to hear and one version: for
 * `useStoreValue`, by a reader whose answer is derived from the two.
 *
 * Both, because a write moves the chain BEFORE it moves the source
 * (`PatchStore.createPatch`): a reader that heard the chain alone would read
 * the source as it was before the write, and keep that.
 */
export function useChainAndSources(val: ValSystem | null, watch: boolean) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null || !watch) return () => {};
      const offChain = val.system.patchStore.events.on("patch:chain", onChange);
      const offSources = val.system.sourceStore.events.on(
        "source:change",
        onChange,
      );
      return () => {
        offChain();
        offSources();
      };
    },
    [val, watch],
  );
  const version = useCallback(
    () =>
      val === null || !watch
        ? ""
        : `${val.system.patchStore.chainVersion()}:${val.system.sourceStore.sourcesVersion()}`,
    [val, watch],
  );
  return { subscribe, version };
}
