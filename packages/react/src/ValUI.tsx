/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
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
} from "@valbuild/core";
import { PatchJSON } from "@valbuild/core/patch";
import { ImageMetadata } from "@valbuild/core/src/schema/image";
import { AuthStatus } from "./AuthStatus";
import { ShadowRoot } from "./ShadowRoot";

export type ValUIProps = {
  valStore: ValStore;
  valApi: ValApi;
};

export default function ValUI({ valApi, valStore }: ValUIProps) {
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editFormPosition, setEditFormPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const [authentication, setAuthentication] = useState<AuthStatus>({
    status: "not-asked",
  });

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
  if (!showEditButton) {
    return null;
  }
  return (
    <ShadowRoot>
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
                        Internal.splitModuleIdAndModulePath(path as SourcePath);
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
                          console.warn(
                            "No .src on input provided - this might mean no changes was made"
                          );
                          return;
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
                        if (input.data.metadata) {
                          if (input.data.addMetadata) {
                            patch.push({
                              value: input.data.metadata,
                              op: "add",
                              path: `/${pathParts.join("/")}/metadata`,
                            });
                          } else {
                            patch.push({
                              value: input.data.metadata,
                              op: "replace",
                              path: `/${pathParts.join("/")}/metadata`,
                            });
                          }
                        }
                        console.log("patch", patch);
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
                      console.error("Submitted incomplete input, ignoring...");
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
    </ShadowRoot>
  );
}
