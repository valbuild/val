/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { lazy, useContext, useMemo } from "react";
import { ValStore } from "./ValStore";
import { ValApi } from "@valbuild/core";
import { ValConfig } from "@valbuild/core/src/initVal";

export function useValStore() {
  return useContext(ValContext).valStore;
}
export function useValApi() {
  return useContext(ValContext).valApi;
}

export type ValContext = {
  readonly valStore: ValStore;
  readonly valApi: ValApi;
};

export const ValContext = React.createContext<ValContext>({
  get valStore(): never {
    throw Error(
      "Val context not found. Ensure components are wrapped by ValProvider!"
    );
  },
  get valApi(): never {
    throw Error(
      "Val context not found. Ensure components are wrapped by ValProvider!"
    );
  },
});

export type ValProviderProps = {
  // host?: string;
  config: ValConfig;
  children?: React.ReactNode;
};
const ValUI =
  typeof window !== "undefined" ? lazy(() => import("./ValUI")) : null;

export function ValProvider({ children }: ValProviderProps) {
  const host = "/api/val";
  const valApi = useMemo(() => new ValApi(host), [host]);
  const valStore = useMemo(() => new ValStore(valApi), [valApi]);
  return (
    <ValContext.Provider value={{ valApi, valStore }}>
      {children}
      {ValUI && <ValUI />}
    </ValContext.Provider>
  );
}
