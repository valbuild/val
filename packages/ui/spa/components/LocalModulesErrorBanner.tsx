import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ValSyncEngine } from "../ValSyncEngine";

export function LocalModulesErrorBanner({
  syncEngine,
}: {
  syncEngine: ValSyncEngine;
}) {
  const subscribe = useMemo(
    () => syncEngine.subscribe("local-modules-status"),
    [syncEngine],
  );
  const getSnapshot = useCallback(
    () => syncEngine.getLocalModulesStatusSnapshot(),
    [syncEngine],
  );
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (process.env.NODE_ENV === "production") return null;
  if (status.type !== "error") return null;
  return (
    <div className="px-3 py-2 bg-bg-warning text-fg-warning text-sm">
      <strong>Val: local module extraction failed.</strong> Falling back to
      server-fetched schema and sources.
      <ul className="mt-1 list-disc list-inside">
        {status.moduleErrors.map((e, i) => (
          <li key={i}>
            {e.path ? <code>{e.path}: </code> : null}
            {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
