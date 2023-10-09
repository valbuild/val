import { AnyRichTextOptions, RichText } from "@valbuild/core";
import { LexicalEditor } from "lexical";
import { useEffect, useState } from "react";
import { RichTextEditor } from "../RichTextEditor/RichTextEditor";
import { FormContainer } from "./FormContainer";
import { ImageForm, ImageData } from "./ImageForm";
import { TextData, TextArea } from "./TextArea";

export type Inputs = {
  [path: string]:
    | { status: "requested" }
    | {
        status: "completed";
        type: "text";
        data: TextData;
      }
    | { status: "completed"; type: "image"; data: ImageData }
    | {
        status: "completed";
        type: "richtext";
        data: RichText<AnyRichTextOptions>;
      };
};

export type FormProps = {
  onSubmit: (nextInputs: Inputs) => void;
  inputs: Inputs;
};

export function Form({ onSubmit, inputs }: FormProps): React.ReactElement {
  const [currentInputs, setCurrentInputs] = useState<Inputs>();
  const [richTextEditor, setRichTextEditor] = useState<{
    [path: string]: LexicalEditor;
  }>();

  useEffect(() => {
    setCurrentInputs(inputs);
  }, [inputs]);

  return (
    <FormContainer
      onSubmit={() => {
        if (currentInputs) {
          onSubmit(
            Object.fromEntries(
              Object.entries(currentInputs).map(([path, input]) => {
                if (input.status === "completed" && input.type === "richtext") {
                  if (!richTextEditor) {
                    throw Error(
                      "Cannot save rich text - editor not initialized"
                    );
                  }
                  return [
                    path,
                    {
                      status: "completed",
                      type: "richtext",
                      data: richTextEditor[path].getEditorState().toJSON()
                        ?.root,
                    },
                  ];
                }
                return [path, input];
              })
            )
          );
        }
      }}
    >
      {currentInputs &&
        Object.entries(currentInputs).map(([path, input]) => (
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
                    setCurrentInputs({
                      ...currentInputs,
                      [path]: {
                        status: "completed",
                        type: "image",
                        data: data.value,
                      },
                    });
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
                  setCurrentInputs({
                    ...currentInputs,
                    [path]: {
                      status: "completed",
                      type: "text",
                      data: data,
                    },
                  });
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
          </div>
        ))}
    </FormContainer>
  );
}
