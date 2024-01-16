"use client";

import { ValConfig } from "@valbuild/core";
import { IS_DEV, VAL_CSS_PATH, VAL_APP_PATH, VAL_APP_ID } from "@valbuild/ui";
import Script from "next/script";

// eslint-disable-next-line no-empty-pattern
export const ValApp = ({}: { config: ValConfig }) => {
  const route = "/api/val";
  return (
    <div>
      <link
        rel="stylesheet"
        href={`${route || "/api/val"}/static${VAL_CSS_PATH}`}
      />
      {IS_DEV && (
        <Script type="module">{`import RefreshRuntime from "${route}/static/@react-refresh"
if (RefreshRuntime.injectIntoGlobalHook) {
  RefreshRuntime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}
  window.$RefreshSig$ = () => (type) => type
  window.__vite_plugin_react_preamble_installed__ = true
}`}</Script>
      )}
      <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
      <div id={VAL_APP_ID}></div>
    </div>
  );
};
