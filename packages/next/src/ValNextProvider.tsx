"use client";
import { ModuleId, ValConfig } from "@valbuild/core";
import { IS_DEV, VAL_APP_PATH, VAL_OVERLAY_ID } from "@valbuild/ui";
import { usePathname, useRouter } from "next/navigation";
import Script from "next/script";
import React, { useEffect, useMemo, useTransition } from "react";
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
  const valEvents = useMemo(() => new ValEvents(), []);
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
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
  }, []);

  // TODO: use portal to mount overlay
  return (
    <ValContext.Provider value={{ valEvents }}>
      {props.children}
      <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
      <div id={VAL_OVERLAY_ID}></div>
    </ValContext.Provider>
  );
};
