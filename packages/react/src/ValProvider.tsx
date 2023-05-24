import React, { useContext, useEffect, useMemo, useState } from "react";
import { ValApi } from "./ValApi";
import { ValStore } from "./ValStore";
import { Style, ValOverlay } from "@valbuild/ui";
import root from "react-shadow"; // TODO: remove dependency on react-shadow here?

export function useValStore() {
  return useContext(ValContext).valStore;
}
export function useValApi() {
  return useContext(ValContext).valApi;
}

export type ValContext = {
  readonly valStore: ValStore;
  readonly valApi: ValApi;
};

export const ValContext = React.createContext<ValContext>({
  get valStore(): never {
    throw Error(
      "Val context not found. Ensure components are wrapped by ValProvider!"
    );
  },
  get valApi(): never {
    throw Error(
      "Val context not found. Ensure components are wrapped by ValProvider!"
    );
  },
});

export type ValProviderProps = {
  host?: string;
  children?: React.ReactNode;
};

type AuthStatus =
  | {
      status:
        | "not-asked"
        | "authenticated"
        | "unauthenticated"
        | "loading"
        | "local";
    }
  | {
      status: "error";
      message: string;
    };

function isValElement(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  if (el.getAttribute("data-val-element") === "true") {
    return true;
  }
  return isValElement(el.parentElement);
}

export function ValProvider({ host = "/api/val", children }: ValProviderProps) {
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editFormPosition, setEditFormPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const [authentication, setAuthentication] = useState<AuthStatus>({
    status: "not-asked",
  });
  const valApi = useMemo(() => new ValApi(host), [host]);
  const valStore = useMemo(() => new ValStore(valApi), [valApi]);

  useEffect(() => {
    if (editMode) {
      valStore.updateAll();
    }
  }, [editMode]);
  useEffect(() => {
    let openValFormListener: ((e: MouseEvent) => void) | undefined = undefined;
    let styleElement: HTMLStyleElement | undefined = undefined;
    const editButtonClickOptions = {
      capture: true,
      passive: true,
    };
    if (editMode) {
      // highlight val element by appending a new style
      styleElement = document.createElement("style");
      styleElement.id = "val-edit-highlight";
      styleElement.innerHTML = `
        .val-edit-mode >* [data-val-path] {
          outline: black solid 2px;
          outline-offset: 4px;
          cursor: pointer;
        }
      `;
      document.body.appendChild(styleElement);

      // capture event clicks on data-val-path elements
      openValFormListener = (e: MouseEvent) => {
        if (e.target instanceof Element) {
          const valSources = e.target?.getAttribute("data-val-path");
          if (valSources) {
            e.stopPropagation();
            setSelectedSources(
              valSources.split(
                ","
              ) /* TODO: just split on commas will not work if path contains , */
            );
            setEditFormPosition({
              left: e.clientX,
              top: e.clientY,
            });
            // } else if (!isValElement(e.target)) {
            //   console.log("click outside", e.target);
            //   setEditFormPosition(null);
            //   setSelectedSources([]);
          }
        }
      };
      document.addEventListener(
        "click",
        openValFormListener,
        editButtonClickOptions
      );
    }
    return () => {
      if (openValFormListener) {
        document.removeEventListener(
          "click",
          openValFormListener,
          editButtonClickOptions
        );
      }
      styleElement?.remove();
    };
  }, [editMode]);

  // useEffect(() => {
  //   const requestAuth = !(
  //     authentication.status === "authenticated" ||
  //     authentication.status === "local"
  //   );
  //   if (requestAuth) {
  //     setSelectedSources([]);
  //     console.log("request auth");
  //     setEditFormPosition(null);
  //   }
  //   if (!editMode) {
  //     // reset state when disabled
  //     setSelectedSources([]);
  //     console.log("reset state");
  //     setEditFormPosition(null);
  //   }
  // }, [editMode, selectedSources.length, authentication.status]);

  useEffect(() => {
    if (editMode) {
      document.body.classList.add("val-edit-mode");
    } else {
      document.body.classList.remove("val-edit-mode");
    }

    if (editMode) {
      if (authentication.status !== "authenticated") {
        valApi
          .getSession()
          .then(async (res) => {
            if (res.status === 401) {
              setAuthentication({
                status: "unauthenticated",
              });
            } else if (res.ok) {
              const data = await res.json();
              if (data.mode === "local") {
                setAuthentication({ status: "local" });
              } else if (data.mode === "proxy") {
                setAuthentication({
                  status: "authenticated",
                });
              } else {
                setAuthentication({
                  status: "error",
                  message: "Unknown authentication mode",
                });
              }
            } else {
              let message = "Unknown error";
              try {
                message = await res.text();
              } catch {
                // ignore
              }
              setAuthentication({
                status: "error",
                message,
              });
            }
          })
          .catch((err) => {
            console.error("Failed to fetch session", err);
            setAuthentication({
              status: "error",
              message: "Unknown authentication mode",
            });
          });
      }
    } else {
      if (authentication.status === "error") {
        setAuthentication({
          status: "not-asked",
        });
      }
    }
  }, [editMode, authentication.status]);

  const [showEditButton, setShowEditButton] = useState(false);
  useEffect(() => {
    setShowEditButton(true);
  }, []);

  return (
    <ValContext.Provider
      value={{
        valApi,
        valStore,
      }}
    >
      {children}
      {showEditButton && (
        <root.div>
          {/* TODO: */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400;1,700&display=swap"
            rel="stylesheet"
          />
          <Style />
          <div data-mode="dark">
            <ValOverlay
              editMode={editMode}
              setEditMode={setEditMode}
              closeValWindow={() => {
                setEditFormPosition(null);
                setSelectedSources([]);
              }}
              valWindow={
                (editFormPosition && {
                  position: editFormPosition,
                  type: "text",
                  path: selectedSources[0],
                  data: "test",
                  onChange: (value) => {
                    //
                  },
                }) ??
                undefined
              }
            />
          </div>
        </root.div>
      )}
    </ValContext.Provider>
  );
}
