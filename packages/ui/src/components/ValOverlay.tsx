import { useState } from "react";
import { EditButton } from "./EditButton";
import { FormContainer } from "./forms/FormContainer";
import { TextInput } from "./forms/TextInput";
import { ValWindow } from "./ValWindow";

export function ValOverlay() {
  const [editMode, setEditMode] = useState(false);
  return (
    <div className="fixed bottom-2 left-2">
      <EditButton
        onClick={() => {
          setEditMode((prev) => !prev);
        }}
      />
      {editMode && (
        <ValWindow
          onClose={() => {
            setEditMode(false);
          }}
        >
          <FormContainer>
            <TextInput
              name="/apps/blogs.0.title"
              source="Hva skjer'a, Bagera?"
              onChange={() => {
                console.log("onChange");
              }}
            />
          </FormContainer>
        </ValWindow>
      )}
    </div>
  );
}
