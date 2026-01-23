import React, { useContext, useSyncExternalStore } from "react";
import { SourcePath } from "@valbuild/core";
import { ValSyncEngine } from "../ValSyncEngine";

type ValErrorContextValue = {
  syncEngine: ValSyncEngine;
};

const ValErrorContext = React.createContext<ValErrorContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error("Cannot use ValErrorContext outside of ValErrorProvider");
      },
    },
  ) as ValErrorContextValue,
);

export function ValErrorProvider({
  children,
  syncEngine,
}: {
  children: React.ReactNode;
  syncEngine: ValSyncEngine;
}) {
  return (
    <ValErrorContext.Provider
      value={{
        syncEngine,
      }}
    >
      {children}
    </ValErrorContext.Provider>
  );
}

export function useValidationErrors(sourcePath: SourcePath) {
  const { syncEngine } = useContext(ValErrorContext);
  const data = useSyncExternalStore(
    syncEngine.subscribe("validation-error", sourcePath),
    () => syncEngine.getValidationErrorSnapshot(sourcePath),
    () => syncEngine.getValidationErrorSnapshot(sourcePath),
  );
  return data || [];
}

export function useAllValidationErrors() {
  const { syncEngine } = useContext(ValErrorContext);
  return useSyncExternalStore(
    syncEngine.subscribe("all-validation-errors"),
    () => syncEngine.getAllValidationErrorsSnapshot(),
    () => syncEngine.getAllValidationErrorsSnapshot(),
  );
}
