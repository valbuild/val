"use client";

import { ValConfig } from "@valbuild/core";
import { Style } from "@valbuild/ui";
import Script from "next/script";

// eslint-disable-next-line no-empty-pattern
export const ValApp = ({}: { config: ValConfig }) => {
  const route = "/api/val";
  return (
    <div>
      <Style route={route} />
      <Script type="module">{`import RefreshRuntime from "${route}/static/@react-refresh"
if (RefreshRuntime.injectIntoGlobalHook) {
  RefreshRuntime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}
  window.$RefreshSig$ = () => (type) => type
  window.__vite_plugin_react_preamble_installed__ = true
}`}</Script>
      <Script type="module" src={`${route}/static/app`} />
      <div id="val-app"></div>
    </div>
  );
};
