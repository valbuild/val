import { FC, useState } from "react";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { Themes, ValProvider } from "./ValProvider";
import { Layout } from "./Layout";
import {
  SharedValConfig,
  VAL_THEME_SESSION_STORAGE_KEY,
} from "@valbuild/shared/internal";
import { ValRouter } from "./ValRouter";

interface ValFullscreenProps {
  client: ValClient;
  config: SharedValConfig | null;
  cssLoaded: boolean;
}

export const ValStudio: FC<ValFullscreenProps> = ({ client, config, cssLoaded  }) => {
  // Theme is initialized by ValNextProvider in session storage
  // We just read it once on init and then rely on React state
  const [theme, setTheme] = useState<Themes | null>(() => {
    const storedTheme = sessionStorage.getItem(VAL_THEME_SESSION_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
    return null;
  });
  return (
    <ValProvider client={client} dispatchValEvents={false} config={config} theme={theme} setTheme={setTheme}>
      <div
        {...(theme ? { "data-mode": theme } : {})}
        className="bg-bg-primary font-sans text-fg-primary"
        style={{
          minHeight: "100svh",
          width: "100vw",
          visibility: "hidden",
        }}
        id="val-app-container"
      >
        <ValRouter>
         {cssLoaded && <Layout />}
        </ValRouter>
      </div>
    </ValProvider>
  );
};
