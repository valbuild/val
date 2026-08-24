import { useEffect, useState } from "react";
import type { SourcePath } from "@valbuild/core";
import { useModuleValidation, useSourceAtPath } from ".";
import { Internal } from "@valbuild/core";

/**
 * One field, rendered through the new hooks, inside the real Studio.
 *
 * Mounted by `ValStoreProvider` and invisible. It exists because "the stores run in
 * the app" and "the hooks render in the app" are different claims, and only the
 * second one is what a component would depend on: the shadow mount proves the
 * system takes real modules in, and this proves a React component can get a value
 * out of it through the same path a real field would take.
 *
 * The path comes from outside — `window.__VAL_STORE_PROBE__(path)` — because a
 * component cannot be handed a path by a test any other way: hooks cannot be
 * called imperatively, so the test sets state and reads the DOM. What it renders
 * is JSON in a `data-` attribute, which is a shape a browser test can assert on
 * without depending on any styling.
 */
export function ValStoreProbe() {
  const [path, setPath] = useState<SourcePath | null>(null);

  useEffect(() => {
    const bag = window as unknown as {
      __VAL_STORE_PROBE__?: (next: string) => void;
    };
    bag.__VAL_STORE_PROBE__ = (next) => setPath(next as SourcePath);
    return () => {
      delete bag.__VAL_STORE_PROBE__;
    };
  }, []);

  if (path === null) {
    return null;
  }
  return <Probe path={path} />;
}

/**
 * Split out so the hooks are only mounted once a path exists.
 *
 * Not an optimisation: `useSourceAtPath` registers a listener and
 * `useModuleValidation` triggers a validation, and doing either for a path of
 * `null` would mean inventing one.
 */
function Probe({ path }: { path: SourcePath }) {
  const source = useSourceAtPath(path);
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const validation = useModuleValidation(moduleFilePath);
  return (
    <span
      style={{ display: "none" }}
      data-val-store-probe={JSON.stringify({
        path,
        source:
          source.status === "success"
            ? { status: "success", data: source.data }
            : source,
        validation: validation.status,
      })}
    />
  );
}
