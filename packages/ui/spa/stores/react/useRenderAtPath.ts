import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { SourcePath } from "@valbuild/core";
import type { RenderRead } from "../RenderStore";
import { useValSystem } from "./SystemContext";

const noopSubscribe = () => () => {};
const NO_RENDER: RenderRead = { status: "no-render" };

/**
 * The reified render at one path — the list/record row title, subtitle and image
 * a container decides for its children.
 *
 * Same shape as the other read hooks: peek for the render, `get` from an effect
 * when the peek says nothing is computed. And the same reason: `executeRender`
 * runs USER CODE (the `select` closure in a schema), which is the single most
 * expensive thing this system can do, and starting it during a render phase React
 * may discard is how it gets run twice for one screen.
 *
 * `no-render-at-path` is the common answer and is not an error: most paths are not
 * container nodes. It is distinct from `no-render`, which is about the module.
 */
export function useRenderAtPath(sourcePath: SourcePath): RenderRead {
  const val = useValSystem();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) {
        return () => {};
      }
      const offResult = val.system.renderStore.events.on(
        "render:result",
        onChange,
      );
      const offStale = val.system.renderStore.events.on(
        "render:invalidate",
        onChange,
      );
      const offError = val.system.renderStore.events.on(
        "render:error",
        onChange,
      );
      return () => {
        offResult();
        offStale();
        offError();
      };
    },
    [val],
  );

  const getSnapshot = useCallback(() => {
    if (val === null) {
      return NO_RENDER;
    }
    return val.system.renderStore.peek(sourcePath);
  }, [val, sourcePath]);

  const seen = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    // Only on `needs-render`. Every other status is an ANSWER, and asking again
    // would re-run `executeRender` — user code — for a module that has already
    // said what it has. `no-render` in particular means the schema declares none,
    // so no amount of asking produces one; that distinction is why the store has
    // a separate `needs-render` at all.
    if (val === null || seen.status !== "needs-render") {
      return;
    }
    void val.system.renderStore.get(sourcePath);
  }, [val, sourcePath, seen]);

  return seen;
}
