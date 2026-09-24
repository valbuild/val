import { FC, useState } from "react";
import { HANDOFF_PARAM } from "../publish/handoff";
import { HandoffPublishTab } from "./shell/HandoffPublishTab";
import { ValClient } from "@valbuild/shared/internal";
import { ValModules } from "@valbuild/core";
import { ValProvider } from "./ValProvider";
import { BuilderPreload } from "../publish/BuilderPreload";
import { Themes } from "./ValThemeProvider";
import { ValShell } from "./shell/ValShell";
import { UploadRequestProvider } from "./UploadRequest";
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

export const ValStudio: FC<ValFullscreenProps> = ({
  client,
  config,
  valModules,
  cssLoaded,
  theme,
  setTheme,
}) => {
  /*
   * A tab a page opened to publish a commit it could not build itself. Read
   * once: the tab is for that one publish, and the Studio's own navigation
   * never adds the parameter.
   */
  const [handoffId] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get(HANDOFF_PARAM),
  );
  return (
    <ValProvider
      client={client}
      dispatchValEvents={false}
      config={config}
      valModules={valModules ?? null}
      theme={theme}
      setTheme={setTheme}
      handsOffPublish={handoffId === null}
    >
      <BuilderPreload />
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
            {/*
             * Above the shell, because the two halves of an upload are in
             * different parts of the tree: the navigation names the gallery and
             * the gallery's own field component performs the upload. See
             * `UploadRequest`.
             */}
            <UploadRequestProvider>
              {cssLoaded &&
                (handoffId !== null ? (
                  <HandoffPublishTab id={handoffId} />
                ) : (
                  <ValShell />
                ))}
            </UploadRequestProvider>
          </ValRouter>
        </div>
      </ErrorBoundary>
    </ValProvider>
  );
};
