"use client";
import { ValConfig } from "@valbuild/core";
import { ValProvider as ReactValProvider } from "@valbuild/react/internal";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useTransition } from "react";

export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
}) => {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    document.addEventListener(
      "build",
      (e) => {
        /* … */
        console.log(e);
      },
      false
    );
  }, []);
  return (
    <ReactValProvider
      onSubmit={(refreshRequired) => {
        if (refreshRequired && !props.disableRefresh) {
          startTransition(() => {
            router.refresh();
          });
        }
      }}
    >
      <Script type="module">{`import RefreshRuntime from "${"/api/val"}/static/@react-refresh"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true`}</Script>
      <Script type="module" src={`${"/api/val"}/static/src/main.jsx`} />
      {props.children}
    </ReactValProvider>
  );
};
