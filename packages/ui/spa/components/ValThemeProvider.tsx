import React, { useContext, useCallback } from "react";
import { VAL_THEME_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";
import { ValConfig } from "@valbuild/core";

export type Themes = "dark" | "light";

type ValThemeContextValue = {
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
};

const ValThemeContext = React.createContext<ValThemeContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          "Cannot use ValThemeContext outside of ValThemeProvider"
        );
      },
    }
  ) as ValThemeContextValue
);

export function ValThemeProvider({
  children,
  theme,
  setTheme,
  config,
}: {
  children: React.ReactNode;
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
  config: ValConfig | undefined;
}) {
  const wrappedSetTheme = useCallback(
    (newTheme: Themes | null) => {
      if (newTheme === "dark" || newTheme === "light") {
        try {
          sessionStorage.setItem(VAL_THEME_SESSION_STORAGE_KEY, newTheme);
          localStorage.setItem(
            "val-theme-" + (config?.project || "unknown"),
            newTheme
          );
        } catch (e) {
          console.error("Error setting theme in storage", e);
        }
        setTheme(newTheme);
      } else if (newTheme === null) {
        try {
          sessionStorage.removeItem(VAL_THEME_SESSION_STORAGE_KEY);
          localStorage.removeItem(
            "val-theme-" + (config?.project || "unknown")
          );
        } catch (e) {
          console.error("Error removing theme from storage", e);
        }
        setTheme(null);
      } else {
        console.warn(`Cannot set invalid theme: ${newTheme}`);
      }
    },
    [setTheme, config]
  );

  return (
    <ValThemeContext.Provider
      value={{
        theme,
        setTheme: wrappedSetTheme,
      }}
    >
      {children}
    </ValThemeContext.Provider>
  );
}

export function useTheme() {
  const { theme, setTheme } = useContext(ValThemeContext);
  return { theme, setTheme };
}
