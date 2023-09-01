import { useEffect, useState } from "react";
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
  const [session, setSession] = useState<
    | {
        mode: "proxy" | "local";
        member_role: "owner" | "editor";
      }
    | null
    | false
  >(null);
  useEffect(() => {
    fetch("/api/val/session").then(async (res) => {
      if (res.status === 200) {
        setSession(await res.json());
      } else {
        console.error("Session: ", res.status, await res.text());
        setSession(false);
      }
    });
  }, []);

  return (
    <>
      <div className="fixed -translate-x-1/2 left-1/2 bottom-4">
        {/* TODO: clean up login and session */}
        {session === false && (
          <a
            href={`/api/val/authorize?redirect_to=${encodeURIComponent(
              location.origin
            )}`}
          >
            Login
          </a>
        )}
        {session && <div>Logged in as: {session.member_role}</div>}
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
