"use client";
import React, { useContext, useMemo } from "react";
import { ValStore } from "./ValStore";
import { ValApi } from "@valbuild/core";
import ValUI from "./ValUI";

// NOTE: ValProviderInternal might not be defined if the user is not using ValProvider. These types reflect that this might be the case
// Addendum: This happens when this module will not be imported if the window === undefined. Not quite sure why this happens though. Some investigations might be in order.
export const useValStore: undefined | (() => ValStore | undefined) = (() => {
  return useContext(ValContext).valStore;
}) as (() => ValStore | undefined) | undefined;

// NOTE: ValProviderInternal might not be defined if the user is not using ValProvider
// Addendum: This happens when this module will not be imported if the window === undefined. Not quite sure why this happens though. Some investigations might be in order.
export const useValApi: undefined | (() => ValApi | undefined) = (() => {
  return useContext(ValContext).valApi;
}) as (() => ValApi | undefined) | undefined;

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
