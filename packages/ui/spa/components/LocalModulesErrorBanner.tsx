import { useCallback, useSyncExternalStore } from "react";
import { useValSystem } from "../stores/react/SystemContext";

/**
 * A dev-only banner for a module the Studio could not read.
 *
 * ## What it now reports, and what it used to
 *
 * It used to say "local module extraction failed, falling back to
 * server-fetched schema and sources", because the engine had two sources for
 * schema and source — the host app's modules and the server — and could fall
 * back from one to the other.
 *
 * There is no fallback any more. Schema and committed source are DERIVED from
 * the host app's `ValModules`, so a module that fails to serialize is a module
 * the Studio cannot show at all. That is a worse outcome than the old one and
 * therefore more worth a banner, not less — but the banner has to say the true
 * thing.
 *
 * Dev only, deliberately: in production this is the app's own bundle failing to
 * load, which the app's error handling owns.
 */
export function LocalModulesErrorBanner() {
  const val = useValSystem();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.host.events.on("host:receive", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? NO_FAILURES : val.system.host.failures()),
    [val],
  );
  const failures = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (process.env.NODE_ENV === "production") return null;
  if (failures.length === 0) return null;
  return (
    <div className="px-3 py-2 bg-bg-warning text-fg-warning text-sm">
      <strong>Val: some modules could not be read.</strong> Their content will
      not appear in the Studio.
      <ul className="mt-1 list-disc list-inside">
        {failures.map((failure, i) => (
          <li key={i}>
            {failure.moduleFilePath ? (
              <code>{failure.moduleFilePath}: </code>
            ) : null}
            {failure.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

const NO_FAILURES: readonly {
  moduleFilePath: string | null;
  message: string;
}[] = [];
