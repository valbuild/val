import { FC } from "react";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { Themes, ValProvider } from "./ValProvider";
import { Layout } from "./Layout";
import { SharedValConfig } from "@valbuild/shared/internal";
import { ValRouter } from "./ValRouter";

interface ValFullscreenProps {
  client: ValClient;
  config: SharedValConfig | null;
  cssLoaded: boolean;
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
}

export const ValStudio: FC<ValFullscreenProps> = ({
  client,
  config,
  cssLoaded,
  theme,
  setTheme,
}) => {
  return (
    <ValProvider
      client={client}
      dispatchValEvents={false}
      config={config}
      theme={theme}
      setTheme={setTheme}
    >
      <div
        style={{
          minHeight: "100svh",
          width: "100vw",
          visibility: "hidden",
        }}
        id="val-app-container"
      >
        <ValRouter>{cssLoaded && <Layout />}</ValRouter>
      </div>
    </ValProvider>
  );
};
