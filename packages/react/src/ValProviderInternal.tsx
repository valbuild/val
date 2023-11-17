"use client";
import React, { useContext, useMemo } from "react";
import { ValStore } from "./ValStore";
import { ValApi } from "@valbuild/core";
import ValUI from "./ValUI";

export function useValStore() {
  return useContext(ValContext).valStore;
}
export function useValApi() {
  return useContext(ValContext).valApi;
}

export type ValContext = {
  readonly valStore?: ValStore;
  readonly valApi?: ValApi;
};

export const ValContext = React.createContext<ValContext>({
  valStore: undefined,
  valApi: undefined,
});

export type ValProviderProps = {
  // host?: string;
  children?: React.ReactNode;
};

function ValProviderInternal({ children }: ValProviderProps) {
  const host = "/api/val";
  const valApi = useMemo(() => new ValApi(host), [host]);
  const valStore = useMemo(() => new ValStore(valApi), [valApi]);
  return (
    <ValContext.Provider value={{ valApi, valStore }}>
      {children}
      <ValUI />
    </ValContext.Provider>
  );
}

export default ValProviderInternal;
