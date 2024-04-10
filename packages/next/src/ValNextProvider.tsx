"use client";

import { Internal, ModuleId, ValConfig } from "@valbuild/core";
import { VAL_APP_PATH, VAL_OVERLAY_ID } from "@valbuild/ui";
import { usePathname, useRouter } from "next/navigation";
import Script from "next/script";
import React, { useEffect } from "react";
import { ValContext, ValEvents } from "./ValContext";

export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
}) => {
  const pathname = usePathname();

  // TODO: use config to get  /val and /api/val
  if (pathname.startsWith("/val")) {
    return props.children;
  }
  const route = "/api/val";

  // TODO: move below into react package
  const valEvents = React.useMemo(() => new ValEvents(), []);
  const [, startTransition] = React.useTransition();
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(false);

  useEffect(() => {
    setEnabled(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`)
    );
  }, []);

  React.useEffect(() => {
    if (enabled) {
      const valEventListener = (event: Event) => {
        if (event instanceof CustomEvent) {
          if (event.detail.type === "module-update") {
            const { moduleId, source } = event.detail;
            if (typeof moduleId === "string" && source !== undefined) {
              valEvents.update(moduleId as ModuleId, source);
            } else {
              console.error("Val: invalid event detail", event.detail);
            }
          } else if (event.detail.type === "overlay-submit") {
            const { refreshRequired } = event.detail;
            if (refreshRequired && !props.disableRefresh) {
              startTransition(() => {
                router.refresh();
              });
            }
          } else {
            console.error("Val: invalid event", event);
          }
        }
      };
      window.addEventListener("val-event", valEventListener);

      return () => {
        window.removeEventListener("val-event", valEventListener);
      };
    } else {
      if (process.env["NODE_ENV"] === "development") {
        console.warn(
          `Val is currently hidden.

To enable Val go to the following URL:
${window.location.origin}/api/val/enable?redirect_to=${encodeURIComponent(
            window.location.href
          )}
          
You are seeing this message because you are in development mode.`
        );
      }
    }
  }, [enabled]);

  // TODO: use portal to mount overlay
  return (
    <ValContext.Provider value={{ valEvents }}>
      {props.children}
      {enabled && (
        <>
          <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
          <div id={VAL_OVERLAY_ID}></div>
        </>
      )}
    </ValContext.Provider>
  );
};
