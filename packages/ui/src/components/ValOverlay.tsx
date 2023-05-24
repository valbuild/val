import { EditButton } from "./EditButton";
import { FormContainer } from "./forms/FormContainer";
import { ImageInput, ImageData } from "./forms/ImageInput";
import { TextInput, TextData } from "./forms/TextInput";
import { ValWindow } from "./ValWindow";

type ValWindow = {
  position: {
    left: number;
    top: number;
  };
  path: string;
  onSubmit: () => void;
  onChange: (
    path: string,
    data:
      | {
          type: "text";
          data: TextData;
        }
      | { type: "image"; data: ImageData }
  ) => void;
} & (
  | {
      type: "text";
      data: TextData;
    }
  | { type: "image"; data: ImageData }
);

export type ValOverlayProps = {
  editMode: boolean;
  setEditMode: (editMode: boolean) => void;
  valWindow?: ValWindow;
  closeValWindow: () => void;
};

export function ValOverlay({
  editMode,
  setEditMode,
  valWindow,
  closeValWindow,
}: ValOverlayProps) {
  return (
    <>
      <div className="fixed -translate-x-1/2 left-1/2 bottom-4">
        <EditButton
          onClick={() => {
            setEditMode(!editMode);
          }}
        />
      </div>
      {editMode && valWindow && (
        <ValWindow onClose={closeValWindow} position={valWindow.position}>
          <FormContainer onSubmit={valWindow.onSubmit}>
            {valWindow.type === "image" && (
              <ImageInput
                name={valWindow.path}
                data={valWindow.data}
                onChange={(data) => {
                  if (data.value) {
                    valWindow.onChange(valWindow.path, {
                      type: "image",
                      data: data.value,
                    });
                  }
                }}
                error={null}
              />
            )}
            {valWindow.type === "text" && (
              <TextInput
                name={valWindow.path}
                text={valWindow.data}
                onChange={(data) => {
                  valWindow.onChange(valWindow.path, {
                    type: "text",
                    data: data,
                  });
                }}
              />
            )}
          </FormContainer>
        </ValWindow>
      )}
    </>
  );
}
