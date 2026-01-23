import React, { useContext, useRef } from "react";
import { useTheme } from "./ValThemeProvider";

type ValPortalContextValue = {
  portalRef: React.RefObject<HTMLDivElement>;
};

const ValPortalContext = React.createContext<ValPortalContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          "Cannot use ValPortalContext outside of ValPortalProvider"
        );
      },
    }
  ) as ValPortalContextValue
);

export function ValPortalProvider({ children }: { children: React.ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  return (
    <ValPortalContext.Provider
      value={{
        portalRef,
      }}
    >
      <div
        data-val-portal="true"
        ref={portalRef}
        {...(theme ? { "data-mode": theme } : {})}
      ></div>
      {children}
    </ValPortalContext.Provider>
  );
}

export function useValPortal() {
  const { portalRef } = useContext(ValPortalContext);
  return portalRef.current;
}
