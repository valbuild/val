import { useCallback, useSyncExternalStore } from "react";
import { useValSystem } from "../../../stores/react/SystemContext";

const NOTHING_TO_UNSUBSCRIBE = () => {};

/**
 * The build the server is serving (`ManifestSource.servedBuild`), or `null`
 * where none is named: local development, a deploy the platform did not
 * build, a Storybook with no system.
 *
 * What the preview reloads on: whoever built it -- this tab, another editor,
 * the assistant, Val Build -- the page in the frame is the old build's
 * document until it is loaded again.
 */
export function useServedBuild(): string | null {
  const manifest = useValSystem()?.system.manifest;
  const subscribe = useCallback(
    (listener: () => void) =>
      manifest?.onServedBuild(listener) ?? NOTHING_TO_UNSUBSCRIBE,
    [manifest],
  );
  return useSyncExternalStore(
    subscribe,
    () => manifest?.servedBuild() ?? null,
    () => null,
  );
}

/**
 * Which document of the page the preview should hold, as far as the build
 * goes: `0` to begin with, and one more each time the served build moves
 * from one build to ANOTHER.
 *
 * Not when the first build is named. The page in the frame was loaded from
 * whatever the server serves; learning its name a moment later is not a new
 * build, and reloading for it would load every canvas twice.
 */
export function nextBuildEpoch(
  previous: { build: string | null; epoch: number },
  build: string | null,
): { build: string | null; epoch: number } {
  if (build === previous.build) return previous;
  if (previous.build === null || build === null) {
    return { build: build ?? previous.build, epoch: previous.epoch };
  }
  return { build, epoch: previous.epoch + 1 };
}
