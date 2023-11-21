"use client";
import React, { lazy, useContext, useEffect, useMemo, useState } from "react";
import { ValStore } from "./ValStore";
import { Internal, ValApi } from "@valbuild/core";

export const useValStore = () => {
  if (!ValContext) {
    return undefined;
  }
  return useContext(ValContext).valStore;
};
export type UseValStore = typeof useValStore;

export const useValApi = () => {
  if (!ValContext) {
    return undefined;
  }
  return useContext(ValContext).valApi;
};
export type UseValApi = typeof useValApi;

export type ValContext = {
  readonly valStore?: ValStore;
  readonly valApi?: ValApi;
};

export const ValContext =
  typeof window !== "undefined"
    ? React.createContext<ValContext>({
        valStore: undefined,
        valApi: undefined,
      })
    : undefined;

export type ValProviderProps = {
  // host?: string;
  children?: React.ReactNode;
};

const ValUI = lazy(() => import("./ValUI"));

export function ValProvider({ children }: ValProviderProps) {
  const host = "/api/val";
  const api = useMemo(() => new ValApi(host), [host]);
  const store = useMemo(() => new ValStore(api), [api]);
  const [isClient, setIsClient] = useState(false);
  const [enabled, setEnabled] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isDraftMode, setDraftMode] = useState(false); // TODO: if enabled, but not in draft mode: show something

  useEffect(() => {
    setIsClient(true);
    try {
      const valEnabled = document.cookie?.includes(
        `${Internal.VAL_ENABLE_COOKIE_NAME}=true`
      );
      setEnabled(valEnabled);
    } catch (e) {
      console.warn("Could not read Val enabled state", e);
    }
    try {
      const valDraftMode = document.cookie?.includes(
        `${Internal.VAL_DRAFT_MODE_COOKIE}=true`
      );
      setDraftMode(valDraftMode);
    } catch (e) {
      console.warn("Could not read Val draft mode", e);
    }
  }, []);
  if (isClient && !enabled && process.env.NODE_ENV === "development") {
    if (!api) {
      console.warn(
        "Val does not seem to be configured properly! Please check that you have wrapper your root layout (or _app) with the ValProvider."
      );
    } else {
      console.log(
        `Val is disabled. Enable it by going here ${window.origin}${
          api.host
        }/enable?redirect_to=${encodeURIComponent(
          window.location.href
        )}. NOTE: this message appears because NODE_ENV is set to development.`
      );
    }
  }
  if (!isClient || !enabled || !store || !api || !ValContext) {
    return <>{children}</>;
  }
  return (
    <ValContext.Provider value={{ valApi: api, valStore: store }}>
      {children}
      <ValUI />
    </ValContext.Provider>
  );
}
