"use client";

import {
  DEFAULT_CONTENT_HOST,
  Internal,
  ModuleFilePath,
  ValConfig,
} from "@valbuild/core";
import {
  VAL_APP_PATH,
  VAL_OVERLAY_ID,
  VERSION as UIVersion,
} from "@valbuild/ui";
import { useRouter } from "next/navigation";
import Script from "next/script";
import React from "react";
import { ValExternalStore, ValOverlayProvider } from "./ValOverlayContext";
import { SET_AUTO_TAG_JSX_ENABLED } from "@valbuild/react/stega";
import { createValClient } from "@valbuild/shared/internal";
import { useRemoteConfigSender } from "./useRemoteConfigSender";

/**
 * Shows the Overlay menu and updates the store which the client side useVal hook uses to display data.
 */
export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
}) => {
  // TODO: use config:
  const route = "/api/val";
  const client = React.useMemo(
    () =>
      createValClient(route, {
        ...props.config,
        contentHostUrl: DEFAULT_CONTENT_HOST,
      }),
    [route, props.config],
  );

  // TODO: move below into react package
  const valStore = React.useMemo(() => new ValExternalStore(), []);
  const [mountOverlay, setMountOverlay] = React.useState<boolean>();
  const [draftMode, setDraftMode] = React.useState<boolean | null>(null);
  const [spaReady, setSpaReady] = React.useState(false);
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const rerenderCounterRef = React.useRef(0);
  const [iframeSrc, setIframeSrc] = React.useState<string | null>(null);

  useConsoleLogEnableVal(mountOverlay);
  React.useEffect(() => {
    if (location.search === "?message_onready=true") {
      console.warn("Val is verifying draft mode...");
      return;
    }
    if (isValStudioPath(location.pathname)) {
      setMountOverlay(false);
      return;
    }
    setMountOverlay(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`),
    );
  }, []);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    const interval = setInterval(() => {
      if (rerenderCounterRef.current > 0) {
        if (!props.disableRefresh) {
          rerenderCounterRef.current = 0;
          startTransition(() => {
            router.refresh();
          });
        }
      }
    }, 500);
    return () => {
      clearInterval(interval);
    };
  }, [mountOverlay, props.disableRefresh]);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    if (draftMode === null) {
      return;
    }
    const valProviderOverlayListener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (!event?.detail.type) {
          console.error(
            "Val: invalid event detail (val-overlay-provider)",
            event,
          );
        }
        if (event.detail.type === "spa-ready") {
          setSpaReady(true);
        } else if (
          event.detail.type === "draftMode" &&
          (typeof event.detail.value === "boolean" ||
            event.detail.value === null)
        ) {
          const draftMode = event.detail.value;
          if (draftMode === true) {
            setIframeSrc((prev) => {
              if (prev === null) {
                return `${route}/draft/enable?redirect_to=${encodeURIComponent(
                  window.location.origin + "/val?message_onready=true",
                )}`;
              }
              return prev;
            });
          } else if (draftMode === false) {
            setIframeSrc((prev) => {
              if (prev === null) {
                return `${route}/draft/disable?redirect_to=${encodeURIComponent(
                  window.location.origin + "/val?message_onready=true",
                )}`;
              }
              return prev;
            });
          }
        } else {
          console.error(
            "Val: invalid event detail (val-overlay-provider)",
            event.detail,
          );
        }
      } else {
        console.error("Val: invalid event (val-overlay-provider)", event);
      }
    };
    window.addEventListener("val-overlay-provider", valProviderOverlayListener);
    return () => {
      window.removeEventListener(
        "val-overlay-provider",
        valProviderOverlayListener,
      );
    };
  }, [mountOverlay, draftMode]);

  const pollDraftStatIdRef = React.useRef(0);
  React.useEffect(() => {
    // continuous polling to check for updates:

    let timeout: NodeJS.Timeout;
    function pollCurrentDraftMode() {
      if (!mountOverlay) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent("val-overlay-spa", {
          detail: {
            type: "draftModeLoading",
            value: iframeSrc !== null,
          },
        }),
      );
      const pollDraftStatId = ++pollDraftStatIdRef.current;
      client("/draft/stat", "GET", {})
        .then((res) => {
          if (pollDraftStatIdRef.current !== pollDraftStatId) {
            return;
          }
          if (res.status === null) {
            // ignore network errors
            return;
          }
          if (res.status === 401) {
            // ignore when not authorized
            return;
          }
          if (res.status !== 200) {
            console.error("Val: could not get draft mode status", res);
            return;
          }
          setDraftMode((prev) => {
            if (prev !== res.json.draftMode) {
              rerenderCounterRef.current++;
              return res.json.draftMode;
            }
            return prev;
          });
        })
        .catch((err) => {
          console.error("Val: could not get draft mode status", err);
        })
        .finally(() => {
          if (pollDraftStatIdRef.current !== pollDraftStatId) {
            return;
          }
          pollDraftStatIdRef.current--;
          timeout = setTimeout(
            pollCurrentDraftMode,
            iframeSrc === null ? 20000 : 100,
          );
        });
    }
    pollCurrentDraftMode();
    return () => {
      clearTimeout(timeout);
    };
  }, [mountOverlay, iframeSrc]);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("val-overlay-spa", {
        detail: {
          type: "draftMode",
          value: draftMode,
        },
      }),
    );
  }, [mountOverlay, draftMode, spaReady]);

  React.useEffect(() => {
    if (!mountOverlay) {
      SET_AUTO_TAG_JSX_ENABLED(false);
    } else {
      if (draftMode) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        const reactServerComponentRefreshListener = (event: Event) => {
          if (event instanceof CustomEvent) {
            if (event.detail?.type === "source-update") {
              const moduleFilePath = event.detail?.moduleFilePath;
              const source = event.detail?.source;
              if (typeof moduleFilePath === "string" && source !== undefined) {
                valStore.update(moduleFilePath as ModuleFilePath, source);
                if (!props.disableRefresh) {
                  rerenderCounterRef.current++;
                }
              } else {
                console.error("Val: invalid event detail", event.detail);
              }
            } else {
              console.error(
                "Val: invalid custom event details (val-event)",
                event.detail,
              );
            }
          } else {
            console.error("Val: invalid custom event (val-event)", event);
          }
        };
        window.addEventListener(
          "val-event",
          reactServerComponentRefreshListener,
        );
        return () => {
          window.removeEventListener(
            "val-event",
            reactServerComponentRefreshListener,
          );
        };
      }
    }
  }, [mountOverlay, draftMode, props.disableRefresh]);

  React.useEffect(() => {
    if (!mountOverlay) {
      return;
    }
    const listener = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data.type === "val-ready") {
        setIframeSrc(null);
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, [mountOverlay]);

  const [dropZone, setDropZone] = React.useState<string | null>(null);
  React.useEffect(() => {
    const storedDropZone = localStorage.getItem("val-menu-drop-zone-default");
    if (storedDropZone) {
      setDropZone(storedDropZone);
    } else {
      setDropZone("val-menu-right-center");
    }
  }, []);
  useRemoteConfigSender(props.config);
  const [spaLoaded, setSpaLoaded] = React.useState(false);

  return (
    <ValOverlayProvider draftMode={draftMode} store={valStore}>
      {props.children}
      {dropZone !== null && !spaLoaded && (
        <React.Fragment>
          <style>
            {`
${positionStyles}
.backdrop-blur {
  backdrop-filter: blur(10px);
}
.text-white {
  color: white;
}
.bg-black {
  background: black;
}
.rounded {
  border-radius: 0.25rem;
}
.fixed {
  position: fixed;
}
.bottom-4 {
  bottom: 1rem;
}
.right-12 {
  right: 3rem;
}
.right-16 {
  right: 4rem;
}
.p-4 {
  padding: 1rem;
}
.p-2 {
  padding: 0.5rem;
}
.p-1 {
  padding: 0.25rem;
}
.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.justify-center {
  justify-content: center;
}
.animate-spin {
  animation: spin 2s linear infinite;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}`}
          </style>
          {/* This same snippet is used in ValOverlay (ValMenu) - we use this to indicate when val is loading */}
          <div className={getPositionClassName(dropZone) + " p-4"}>
            <div className="flex justify-center items-center p-2 text-white bg-black rounded backdrop-blur">
              <Clock className="animate-spin" size={16} />
            </div>
          </div>
        </React.Fragment>
      )}
      {mountOverlay && draftMode !== null && (
        <React.Fragment>
          <Script
            type="module"
            src={`${route}/static${UIVersion ? `/${UIVersion}` : ""}${VAL_APP_PATH}`}
            crossOrigin="anonymous"
            onLoad={() => {
              setSpaLoaded(true);
            }}
          />
          {/* TODO: use portal to mount overlay */}
          <div id={VAL_OVERLAY_ID}></div>
        </React.Fragment>
      )}
      {/**
       * This iframe is used to enable or disable draft mode.
       * In Next.js applications, the draft mode must be switched on the API side.
       * We load the App.tsx with a query parameter, that tells us whether or not it is in draft mode.
       */}
      {iframeSrc && draftMode !== null && mountOverlay && (
        <iframe
          style={{
            top: 0,
            left: 0,
            position: "absolute",
            width: 0,
            height: 0,
          }}
          src={iframeSrc}
          key={iframeSrc}
        />
      )}
    </ValOverlayProvider>
  );
};

function useConsoleLogEnableVal(showOverlay?: boolean) {
  React.useEffect(() => {
    if (
      process.env["NODE_ENV"] === "development" &&
      showOverlay === false &&
      !isValStudioPath(location.pathname)
    ) {
      console.warn(
        `
###########
###########
###########                           @@@@
###########                             @@
###########    @@      @@  @@@@@@ @     @@
###########     @@    @@  @@     @@     @@
###########     @@    @@ %@       @     @@
####  #####      @@  @@  .@      .@     @@
###    ####       @@@@    @@:   @@@.    @@
####  #####       @@@@      @@@@  =@@@@@@@@@
###########

This page is built with Val Build - the lightweight CMS where content is code.

Val is currently hidden.

To show Val, go to the following URL:
${window.location.origin}/api/val/enable?redirect_to=${encodeURIComponent(
          window.location.href,
        )}
        
You are seeing this message because you are in development mode.`,
      );
    }
  }, [showOverlay]);
}

const positionStyles = `
.left-0 {
  left: 0;
}
.top-0 {
  top: 0;
}
.left-1\\/2 {
  left: 50%;
}
.top-1\\/2 {
  top: 50%;
}
.-translate-y-1\\/2 {
  transform: translateY(-50%);
}
.-translate-x-1\\/2 {
  transform: translateX(-50%);
}
.right-0 {
  right: 0;
}
.bottom-0 {
  bottom: 0;
}`;
// This is a copy of the function from the ValMenu component.
function getPositionClassName(dropZone: string | null) {
  let className = "fixed transform";
  if (dropZone === "val-menu-left-top") {
    className += " left-0 top-0";
  } else if (dropZone === "val-menu-left-center") {
    className += " left-0 top-1/2 -translate-y-1/2";
  } else if (dropZone === "val-menu-left-bottom") {
    className += " left-0 bottom-0";
  } else if (dropZone === "val-menu-center-top") {
    className += " left-1/2 -translate-x-1/2 top-0";
  } else if (dropZone === "val-menu-center-bottom") {
    className += " left-1/2 -translate-x-1/2 bottom-0";
  } else if (dropZone === "val-menu-right-top") {
    className += " right-0 top-0";
  } else if (dropZone === "val-menu-right-center") {
    className += " right-0 top-1/2 -translate-y-1/2";
  } else if (dropZone === "val-menu-right-bottom") {
    className += " right-0 bottom-0";
  } else {
    className += " right-0 bottom-0";
  }
  return className;
}

function isValStudioPath(pathname: string): boolean {
  return pathname.startsWith("/val");
}

// function ValIcon() {
//   return (
//     <svg
//       width="32"
//       height="32"
//       viewBox="0 0 105 149"
//       fill="none"
//       xmlns="http://www.w3.org/2000/svg"
//     >
//       <g filter="url(#filter0_d_14_634)">
//         <path
//           d="M21.4768 23.3474C21.4768 22.4628 22.1939 21.7457 23.0785 21.7457H77.1357C78.0203 21.7457 78.7374 22.4628 78.7374 23.3474V125.055C78.7374 125.94 78.0203 126.657 77.1357 126.657H23.0785C22.1939 126.657 21.4768 125.94 21.4768 125.055V23.3474Z"
//           fill="#38CD98"
//         />
//       </g>
//       <g filter="url(#filter1_i_14_634)">
//         <circle cx="49.9068" cy="104.233" r="9.61017" fill="#1E1F2A" />
//       </g>
//       <defs>
//         <filter
//           id="filter0_d_14_634"
//           x="0.0397091"
//           y="0.30863"
//           width="100.135"
//           height="147.785"
//           filterUnits="userSpaceOnUse"
//           colorInterpolationFilters="sRGB"
//         >
//           <feFlood floodOpacity="0" result="BackgroundImageFix" />
//           <feColorMatrix
//             in="SourceAlpha"
//             type="matrix"
//             values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
//             result="hardAlpha"
//           />
//           <feOffset />
//           <feGaussianBlur stdDeviation="10.7185" />
//           <feComposite in2="hardAlpha" operator="out" />
//           <feColorMatrix
//             type="matrix"
//             values="0 0 0 0 0.219608 0 0 0 0 0.803922 0 0 0 0 0.501961 0 0 0 0.3 0"
//           />
//           <feBlend
//             mode="normal"
//             in2="BackgroundImageFix"
//             result="effect1_dropShadow_14_634"
//           />
//           <feBlend
//             mode="normal"
//             in="SourceGraphic"
//             in2="effect1_dropShadow_14_634"
//             result="shape"
//           />
//         </filter>
//         <filter
//           id="filter1_i_14_634"
//           x="40.2966"
//           y="94.6229"
//           width="19.2205"
//           height="19.2204"
//           filterUnits="userSpaceOnUse"
//           colorInterpolationFilters="sRGB"
//         >
//           <feFlood floodOpacity="0" result="BackgroundImageFix" />
//           <feBlend
//             mode="normal"
//             in="SourceGraphic"
//             in2="BackgroundImageFix"
//             result="shape"
//           />
//           <feColorMatrix
//             in="SourceAlpha"
//             type="matrix"
//             values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
//             result="hardAlpha"
//           />
//           <feOffset />
//           <feGaussianBlur stdDeviation="2.40254" />
//           <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
//           <feColorMatrix
//             type="matrix"
//             values="0 0 0 0 0.219608 0 0 0 0 0.803922 0 0 0 0 0.501961 0 0 0 0.3 0"
//           />
//           <feBlend
//             mode="normal"
//             in2="shape"
//             result="effect1_innerShadow_14_634"
//           />
//         </filter>
//       </defs>
//     </svg>
//   );
// }

function Clock({ className, size }: { className?: string; size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"lucide lucide-clock " + className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
