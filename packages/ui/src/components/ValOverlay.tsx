import { EditButton } from "./EditButton";
import { Form, FormProps } from "./forms/Form";
import { ValWindow } from "./ValWindow";

type ValWindow = {
  position: {
    left: number;
    top: number;
  };
} & FormProps;

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
          <Form onSubmit={valWindow.onSubmit} inputs={valWindow.inputs} />
        </ValWindow>
      )}
    </>
  );
}
