import { useEffect, useState } from "react";
import { FormContainer } from "./FormContainer";
import { ImageForm, ImageData } from "./ImageForm";
import { TextData, TextForm } from "./TextForm";

export type Inputs = {
  [path: string]:
    | { status: "requested" }
    | {
        status: "completed";
        type: "text";
        data: TextData;
      }
    | { status: "completed"; type: "image"; data: ImageData };
};

export type FormProps = {
  onSubmit: (nextInputs: Inputs) => void;
  inputs: Inputs;
};

export function Form({ onSubmit, inputs }: FormProps): React.ReactElement {
  const [currentInputs, setCurrentInputs] = useState<Inputs>();

  useEffect(() => {
    setCurrentInputs(inputs);
  }, [inputs]);

  return (
    <FormContainer
      onSubmit={() => {
        if (currentInputs) {
          onSubmit(currentInputs);
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
              <TextForm
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
          </div>
        ))}
    </FormContainer>
  );
}
