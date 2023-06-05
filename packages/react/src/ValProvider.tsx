"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { lazy, useContext, useMemo } from "react";
import { ValApi } from "./ValApi";
import { ValStore } from "./ValStore";

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
  host?: string;
  children?: React.ReactNode;
};
const ValUI =
  typeof window !== "undefined" ? lazy(() => import("./ValUI")) : null;

export default function ValProvider({
  host = "/api/val",
  children,
}: ValProviderProps) {
  const valApi = useMemo(() => new ValApi(host), [host]);
  const valStore = useMemo(() => new ValStore(valApi), [valApi]);
  return (
    <ValContext.Provider value={{ valApi, valStore }}>
      {children}
      {ValUI && <ValUI valApi={valApi} valStore={valStore} />}
    </ValContext.Provider>
  );
}
