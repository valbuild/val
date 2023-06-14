import {
  RichText,
  FILE_REF_PROP,
  VAL_EXTENSION,
  Internal,
  FileSource,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { PatchJSON } from "@valbuild/core/patch";
import { Json, JsonArray } from "@valbuild/core/src/Json";
import { ImageMetadata } from "@valbuild/core/src/schema/image";
import { ValApi } from "@valbuild/react";
import { LexicalEditor } from "lexical";
import React, { FC, useEffect, useMemo, useState } from "react";
import Button from "./Button";
import { Form, Inputs } from "./forms/Form";
import { ImageForm } from "./forms/ImageForm";
import { TextForm } from "./forms/TextForm";
import { RichTextEditor } from "./RichTextEditor/RichTextEditor";

interface SourceCollapsibleProps {
  source: Json;
  idx: number;
  schema: SerializedSchema;
  valApi: ValApi;
  path: string;
  selectedSubmodule: string;
}

const SourceCollapsible: FC<SourceCollapsibleProps> = ({
  source,
  schema,
  idx,
  valApi,
  path,
  selectedSubmodule,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [inputs, setInputs] = useState<Inputs>({});
  const [inputIsDirty, setInputIsDirty] = useState<{ [path: string]: boolean }>(
    {}
  );
  const [richTextEditor, setRichTextEditor] = useState<{
    [path: string]: LexicalEditor;
  }>();

  useEffect(() => {
    setIsOpen(selectedSubmodule === source?.title);
  }, [selectedSubmodule]);

  useEffect(() => {
    if (schema.type === "array") {
      for (const key of Object.keys(schema.item.items)) {
        if (key !== "rank") {
          valApi.getModule(`${path}${idx}.${key}`).then((serializedModule) => {
            console.log("serialized module", serializedModule);
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
      }
    }
  }, []);

  useEffect(() => {
    for (const key of Object.keys(inputs)) {
      if (!Object.keys(inputIsDirty).includes(key)) {
        setInputIsDirty({
          ...inputIsDirty,
          [key]: false,
        });
      }
    }
  }, [inputs]);

  const patchElement = async (key: string) => {
    Promise.all(
      Object.entries(inputs)
        .filter(([k]) => k === key)
        .map(([path, input]) => {
          if (input.status === "completed") {
            const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(
              path as SourcePath
            );
            if (input.type === "text") {
              const patch: PatchJSON = [
                {
                  value: input.data,
                  op: "replace",
                  path: `/${modulePath
                    .split(".")
                    .map((p) => {
                      console.log("p", modulePath, modulePath.split("."), p);
                      return JSON.parse(p);
                    })
                    .join("/")}`,
                },
              ];
              console.log("patch", patch);
              return valApi.patchModuleContent(moduleId, patch);
            } else if (input.type === "image") {
              const pathParts = modulePath.split(".").map((p) => JSON.parse(p));

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
            throw new Error(`Unsupported input type: ${(input as any).type}`);
          } else {
            console.error("Submitted incomplete input, ignoring...");
            return Promise.resolve();
          }
        })
    ).then((res) => {
      console.log("patched", res);
    });
  };

  // const patchElement = async (key: string) => {
  //   const input = inputs[key];
  //   console.log('heyyy',input)
  //   const patchPromise = () => {
  //     if (input.status === "completed") {
  //       const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(
  //         key as any as SourcePath
  //       );
  //       if (input.type === "text") {
  //         const patch: PatchJSON = [
  //           {
  //             value: input.data,
  //             op: "replace",
  //             path: `/${modulePath
  //               .split(".")
  //               .map((p) => {
  //                 console.log("p", modulePath, modulePath.split("."), p);
  //                 return JSON.parse(p);
  //               })
  //               .join("/")}`,
  //           },
  //         ];
  //         console.log("patch", patch);
  //         return valApi.patchModuleContent(moduleId, patch);
  //       } else if (input.type === "image") {
  //         const pathParts = modulePath.split(".").map((p) => JSON.parse(p));

  //         if (!input?.data || !("src" in input.data)) {
  //           // TODO: We probably need to have an Output type that is different from the Input: we have a union of both cases in Input right now, and we believe we do not want that
  //           console.warn(
  //             "No .src on input provided - this might mean no changes was made"
  //           );
  //           return;
  //         }
  //         const patch: PatchJSON = [
  //           {
  //             value: input.data.src,
  //             op: "replace",
  //             path: `/${pathParts.slice(0, -1).join("/")}/$${
  //               pathParts[pathParts.length - 1]
  //             }`,
  //           },
  //         ];
  //         if (input.data.metadata) {
  //           if (input.data.addMetadata) {
  //             patch.push({
  //               value: input.data.metadata,
  //               op: "add",
  //               path: `/${pathParts.join("/")}/metadata`,
  //             });
  //           } else {
  //             patch.push({
  //               value: input.data.metadata,
  //               op: "replace",
  //               path: `/${pathParts.join("/")}/metadata`,
  //             });
  //           }
  //         }
  //         console.log("patch", patch);
  //         return valApi.patchModuleContent(moduleId, patch);
  //       } else if (input.type === "richtext") {
  //         const patch: PatchJSON = [
  //           {
  //             value: input.data,
  //             op: "replace",
  //             path: `/${modulePath
  //               .split(".")
  //               .map((p) => JSON.parse(p))
  //               .join("/")}`,
  //           },
  //         ];
  //         return valApi.patchModuleContent(moduleId, patch);
  //       }
  //       throw new Error(`Unsupported input type: ${(input as any).type}`);
  //     } else {
  //       console.error("Submitted incomplete input, ignoring...");
  //       return Promise.resolve();
  //     }
  //   };

  //   const patch = await patchPromise();
  // };

  return (
    <div className="flex flex-col items-start w-full">
      <button onClick={() => setIsOpen(!isOpen)} className="">
        {source.title}
      </button>
      {isOpen && (
        <div className="flex flex-col gap-4">
          {Object.entries(inputs).map(([path, input]) => {
            return (
              <div key={path}>
                {input.status === "requested" && (
                  <div className="p-2 text-center text-primary">Loading...</div>
                )}
                {input.status === "completed" && input.type === "image" && (
                  <ImageForm
                    name={path}
                    data={input.data}
                    onChange={(data) => {
                      if (data.value) {
                        setInputs({
                          ...inputs,
                          [path]: {
                            status: "completed",
                            type: "image",
                            data: data.value,
                          },
                        });
                        setInputIsDirty({ ...inputIsDirty, [path]: true });
                      }
                    }}
                    error={null}
                  />
                )}
                {input.status === "completed" && input.type === "text" && (
                  <TextForm
                    name={path}
                    text={input.data}
                    onChange={(data) => {
                      setInputs({
                        ...inputs,
                        [path]: {
                          status: "completed",
                          type: "text",
                          data: data,
                        },
                      });
                      setInputIsDirty({ ...inputIsDirty, [path]: true });
                    }}
                  />
                )}
                {input.status === "completed" && input.type === "richtext" && (
                  <RichTextEditor
                    richtext={input.data}
                    onEditor={(editor) => {
                      setRichTextEditor({
                        ...richTextEditor,
                        [path]: editor,
                      });
                    }}
                  />
                )}
                {inputIsDirty[path] && (
                  <Button onClick={() => patchElement(path)}>
                    Save changes
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SourceCollapsible;
