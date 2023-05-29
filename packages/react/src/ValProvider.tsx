import React, { useContext, useEffect, useMemo, useState } from "react";
import { ValApi } from "./ValApi";
import { ValStore } from "./ValStore";
import { Inputs, Style, ValOverlay } from "@valbuild/ui";
import root from "react-shadow"; // TODO: remove dependency on react-shadow here?
import {
  FileSource,
  FILE_REF_PROP,
  Internal,
  RichText,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/lib";
import { PatchJSON } from "@valbuild/lib/patch";
import { ImageMetadata } from "@valbuild/lib/src/schema/image";

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
          let parent = e.target;
          while (parent && parent !== document.body) {
            if (parent.getAttribute("data-val-path")) {
              break;
            }
            if (parent.parentElement) {
              parent = parent.parentElement;
            } else {
              break;
            }
          }
          const valSources = parent?.getAttribute("data-val-path");
          if (valSources) {
            e.stopPropagation();
            setSelectedSources(
              valSources.split(
                ","
              ) /* TODO: just split on commas will not work if path contains , */
            );
            setEditFormPosition({
              left: e.pageX,
              top: e.pageY,
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

  const [inputs, setInputs] = useState<Inputs>({});

  useEffect(() => {
    setInputs({});
    for (const path of selectedSources) {
      valApi.getModule(path).then((serializedModule) => {
        let input: Inputs[string] | undefined;
        if (
          serializedModule.schema.type === "string" &&
          typeof serializedModule.source === "string"
        ) {
          input = {
            status: "completed",
            type: "text",
            data: serializedModule.source,
          };
        } else if (
          serializedModule.schema.type === "richtext" &&
          typeof serializedModule.source === "object"
        ) {
          input = {
            status: "completed",
            type: "richtext",
            data: serializedModule.source as RichText, // TODO: validate
          };
        } else if (
          serializedModule.schema.type === "image" &&
          serializedModule.source &&
          typeof serializedModule.source === "object" &&
          FILE_REF_PROP in serializedModule.source &&
          typeof serializedModule.source[FILE_REF_PROP] === "string" &&
          VAL_EXTENSION in serializedModule.source &&
          typeof serializedModule.source[VAL_EXTENSION] === "string"
        ) {
          input = {
            status: "completed",
            type: "image",
            data: Internal.convertImageSource(
              serializedModule.source as FileSource<ImageMetadata>
            ),
          };
        }
        console.log("input path", path);
        console.log("serialized path", serializedModule.path);
        if (!input) {
          throw new Error(
            `Unsupported module type: ${serializedModule.schema.type}`
          );
        }
        setInputs((inputs) => {
          return {
            ...inputs,
            [serializedModule.path]: input,
          } as Inputs;
        });
      });
    }
  }, [selectedSources.join(",")]);
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
                setInputs({});
              }}
              valWindow={
                (editFormPosition && {
                  position: editFormPosition,
                  inputs,
                  onSubmit: (inputs) => {
                    Promise.all(
                      Object.entries(inputs).map(([path, input]) => {
                        if (input.status === "completed") {
                          const [moduleId, modulePath] =
                            Internal.splitModuleIdAndModulePath(
                              path as SourcePath
                            );
                          if (input.type === "text") {
                            const patch: PatchJSON = [
                              {
                                value: input.data,
                                op: "replace",
                                path: `/${modulePath
                                  .split(".")
                                  .map((p) => JSON.parse(p))
                                  .join("/")}`,
                              },
                            ];
                            return valApi.patchModuleContent(moduleId, patch);
                          } else if (input.type === "image") {
                            const pathParts = modulePath
                              .split(".")
                              .map((p) => JSON.parse(p));

                            if (!input?.data || !("src" in input.data)) {
                              // TODO: We probably need to have an Output type that is different from the Input: we have a union of both cases in Input right now, and we believe we do not want that
                              throw new Error("No .src on input provided");
                            }
                            const patch: PatchJSON = [
                              {
                                value: input.data.src,
                                op: "replace",
                                path: `/${pathParts.slice(0, -1).join("/")}/$${
                                  pathParts[pathParts.length - 1]
                                }`,
                              },
                            ];
                            console.log(patch);
                            return valApi.patchModuleContent(moduleId, patch);
                          } else if (input.type === "richtext") {
                            const patch: PatchJSON = [
                              {
                                value: input.data,
                                op: "replace",
                                path: `/${modulePath
                                  .split(".")
                                  .map((p) => JSON.parse(p))
                                  .join("/")}`,
                              },
                            ];
                            return valApi.patchModuleContent(moduleId, patch);
                          }
                          throw new Error(
                            `Unsupported input type: ${(input as any).type}`
                          );
                        } else {
                          console.error(
                            "Submitted incomplete input, ignoring..."
                          );
                          return Promise.resolve();
                        }
                      })
                    ).then(() => {
                      setEditFormPosition(null);
                      setSelectedSources([]);
                      setInputs({});
                    });
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
