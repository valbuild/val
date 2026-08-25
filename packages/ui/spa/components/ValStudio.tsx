import { FC, useState } from "react";
import { ValClient } from "@valbuild/shared/internal";
import { ValModules } from "@valbuild/core";
import { ValProvider } from "./ValProvider";
import { Themes } from "./ValThemeProvider";
import { Layout } from "./Layout";
import { ValShell } from "./shell/ValShell";
import { SharedValConfig } from "@valbuild/shared/internal";
import { ValRouter } from "./ValRouter";
import { ErrorBoundary } from "react-error-boundary";
import { FallbackComponent } from "../fallbackRender";

interface ValFullscreenProps {
  client: ValClient;
  config: SharedValConfig | null;
  valModules?: ValModules | null;
  cssLoaded: boolean;
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
}

/**
 * The shell the studio renders in.
 *
 * The floating shell is what the studio is becoming, so it is the default. The
 * previous layout stays reachable with `?val-ui=classic` while the two are
 * being compared — a redesign this size is judged side by side, and needing a
 * rebuild to see the old one makes that comparison not happen.
 *
 * Read once on mount rather than watched: switching layouts mid-session would
 * remount the whole provider tree under it, and the flag is set by opening a
 * URL, which is a load anyway.
 */
function useLayoutChoice(): "shell" | "classic" {
  const [choice] = useState<"shell" | "classic">(() => {
    if (typeof window === "undefined") return "shell";
    try {
      const param = new URLSearchParams(window.location.search).get("val-ui");
      return param === "classic" ? "classic" : "shell";
    } catch {
      return "shell";
    }
  });
  return choice;
}

export const ValStudio: FC<ValFullscreenProps> = ({
  client,
  config,
  valModules,
  cssLoaded,
  theme,
  setTheme,
}) => {
  const layoutChoice = useLayoutChoice();
  return (
    <ValProvider
      client={client}
      dispatchValEvents={false}
      config={config}
      valModules={valModules ?? null}
      theme={theme}
      setTheme={setTheme}
    >
      <ErrorBoundary FallbackComponent={FallbackComponent}>
        <div
          style={{
            minHeight: "100svh",
            width: "100vw",
            visibility: "hidden",
          }}
          id="val-app-container"
        >
          <ValRouter>
            {cssLoaded &&
              (layoutChoice === "classic" ? <Layout /> : <ValShell />)}
          </ValRouter>
        </div>
      </ErrorBoundary>
    </ValProvider>
  );
};
