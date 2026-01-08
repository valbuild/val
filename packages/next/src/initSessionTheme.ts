import { ValConfig } from "@valbuild/core";
import { VAL_THEME_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";

export function initSessionTheme(config: ValConfig) {
  const existingSessionTheme = sessionStorage.getItem(
    VAL_THEME_SESSION_STORAGE_KEY,
  );
  if (
    existingSessionTheme &&
    (existingSessionTheme === "dark" || existingSessionTheme === "light")
  ) {
    return existingSessionTheme;
  }
  const storedTheme = localStorage.getItem(
    "val-theme-" + (config?.project || "unknown"),
  );
  let theme: "dark" | "light" = "dark";
  if (storedTheme === "light" || storedTheme === "dark") {
    theme = storedTheme;
  } else if (
    config?.defaultTheme === "dark" ||
    config?.defaultTheme === "light"
  ) {
    theme = config.defaultTheme;
  }
  sessionStorage.setItem(VAL_THEME_SESSION_STORAGE_KEY, theme);
  return theme;
}
