import {
  FileSource,
  FILE_REF_PROP,
  Internal,
  RichText,
  SerializedModule,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import { PatchJSON } from "@valbuild/core/patch";
import { ImageMetadata } from "@valbuild/core/src/schema/image";
import { ValApi } from "@valbuild/react";
import { LexicalEditor } from "lexical";
import { FC, useEffect, useState } from "react";
import { Inputs, RichTextEditor } from "../../exports";
import Button from "../Button";
import { ImageForm } from "../forms/ImageForm";
import { TextArea } from "../forms/TextArea";

interface ValDashboardEditorProps {
  selectedPath: string;
  valApi: ValApi;
}

export const ValDashboardEditor: FC<ValDashboardEditorProps> = ({
  selectedPath,
  valApi,
}) => {
  const [selectedModule, setSelectedModule] = useState<SerializedModule>();
  const [inputs, setInputs] = useState<Inputs>({});
  const [inputIsDirty, setInputIsDirty] = useState<{ [path: string]: boolean }>(
    {}
  );
  const [richTextEditor, setRichTextEditor] = useState<{
    [path: string]: LexicalEditor;
  }>();

  useEffect(() => {
    // if (selectedPath) {
    //   valApi.getModule(selectedPath).then((module) => {
    //     setSelectedModule(module);
    //   });
    // }
  }, [selectedPath]);

  useEffect(() => {
    // if (selectedModule && selectedModule?.source) {
    //   setInputs({});
    //   for (const key of Object.keys(selectedModule?.source)) {
    //     if (key !== "rank") {
    //     valApi
    //       .getModule(`${selectedModule.path}.${key}`)
    //       .then((serializedModule) => {
    //         let input: Inputs[string] | undefined;
    //         if (
    //           serializedModule.schema.type === "string" &&
    //           typeof serializedModule.source === "string"
    //         ) {
    //           input = {
    //             status: "completed",
    //             type: "text",
    //             data: serializedModule.source,
    //           };
    //         } else if (
    //           serializedModule.schema.type === "richtext" &&
    //           typeof serializedModule.source === "object"
    //         ) {
    //           input = {
    //             status: "completed",
    //             type: "richtext",
    //             data: serializedModule.source as RichText, // TODO: validate
    //           };
    //         } else if (
    //           serializedModule.schema.type === "image" &&
    //           serializedModule.source &&
    //           typeof serializedModule.source === "object" &&
    //           FILE_REF_PROP in serializedModule.source &&
    //           typeof serializedModule.source[FILE_REF_PROP] === "string" &&
    //           VAL_EXTENSION in serializedModule.source &&
    //           typeof serializedModule.source[VAL_EXTENSION] === "string"
    //         ) {
    //           input = {
    //             status: "completed",
    //             type: "image",
    //             data: Internal.convertImageSource(
    //               serializedModule.source as FileSource<ImageMetadata>
    //             ),
    //           };
    //         }
    //         if (!input) {
    //           throw new Error(
    //             `Unsupported module type: ${serializedModule.schema.type}`
    //           );
    //         }
    //         setInputs((inputs) => {
    //           return {
    //             ...inputs,
    //             [serializedModule.path]: input,
    //           } as Inputs;
    //         });
    //       });
    //   }
    // }
    // }
  }, [selectedModule]);

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
    // Promise.all(
    //   Object.entries(inputs)
    //     .filter(([k]) => k === key)
    //     .map(([path, input]) => {
    //       if (input.status === "completed") {
    //         const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(
    //           path as SourcePath
    //         );
    //         if (input.type === "text") {
    //           const patch: PatchJSON = [
    //             {
    //               value: input.data,
    //               op: "replace",
    //               path: `/${modulePath
    //                 .split(".")
    //                 .map((p) => {
    //                   return JSON.parse(p);
    //                 })
    //                 .join("/")}`,
    //             },
    //           ];
    //           console.log("patch", patch);
    //           return valApi.patchModuleContent(moduleId, patch);
    //         } else if (input.type === "image") {
    //           const pathParts = modulePath.split(".").map((p) => JSON.parse(p));
    //           if (!input?.data || !("src" in input.data)) {
    //             // TODO: We probably need to have an Output type that is different from the Input: we have a union of both cases in Input right now, and we believe we do not want that
    //             console.warn(
    //               "No .src on input provided - this might mean no changes was made"
    //             );
    //             return;
    //           }
    //           const patch: PatchJSON = [
    //             {
    //               value: input.data.src,
    //               op: "replace",
    //               path: `/${pathParts.slice(0, -1).join("/")}/$${
    //                 pathParts[pathParts.length - 1]
    //               }`,
    //             },
    //           ];
    //           if (input.data.metadata) {
    //             if (input.data.addMetadata) {
    //               patch.push({
    //                 value: input.data.metadata,
    //                 op: "add",
    //                 path: `/${pathParts.join("/")}/metadata`,
    //               });
    //             } else {
    //               patch.push({
    //                 value: input.data.metadata,
    //                 op: "replace",
    //                 path: `/${pathParts.join("/")}/metadata`,
    //               });
    //             }
    //           }
    //           console.log("patch", patch);
    //           return valApi.patchModuleContent(moduleId, patch);
    //         } else if (input.type === "richtext") {
    //           const patch: PatchJSON = [
    //             {
    //               value: input.data,
    //               op: "replace",
    //               path: `/${modulePath
    //                 .split(".")
    //                 .map((p) => JSON.parse(p))
    //                 .join("/")}`,
    //             },
    //           ];
    //           return valApi.patchModuleContent(moduleId, patch);
    //         }
    //         // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //         throw new Error(`Unsupported input type: ${(input as any).type}`);
    //       } else {
    //         console.error("Submitted incomplete input, ignoring...");
    //         return Promise.resolve();
    //       }
    //     })
    // ).then((res) => {
    //   console.log("patched", res);
    // });
  };

  return (
    <div className="flex flex-col items-start px-4">
      {selectedModule ? (
        <div className="flex flex-col items-start w-full py-3 gap-[36px] font-normal">
          {Object.entries(inputs).map(([path, input]) => {
            return (
              <div key={path} className={"flex flex-col justify-start "}>
                {input.status === "requested" && (
                  <div className="p-2 text-center text-primary">Loading...</div>
                )}
                <div className="flex flex-col gap-1 font-[550]">
                  <p>{path.split(".").slice(-1)[0].split('"').join("")}</p>
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
                    <TextArea
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
                  {input.status === "completed" &&
                    input.type === "richtext" && (
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
              </div>
            );
          })}
        </div>
      ) : (
        <h1 className="px-4 py-3">No module selected</h1>
      )}
    </div>
  );
};
