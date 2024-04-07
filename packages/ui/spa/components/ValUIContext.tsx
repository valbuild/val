import React, { Dispatch, SetStateAction } from "react";
import type { Remote } from "../utils/Remote";
import type { Session } from "../dto/Session";

export type Theme = "dark" | "light";
export type EditMode = "off" | "hover" | "window" | "full";
export type WindowSize = {
  width: number;
  height: number;
  innerHeight: number;
};

export const ValUIContext = React.createContext<{
  session: Remote<Session>;
  editMode: EditMode;
  setEditMode: Dispatch<SetStateAction<EditMode>>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setWindowSize: (size: WindowSize) => void;
  windowSize?: WindowSize;
}>({
  get session(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
  get theme(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
  get setTheme(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
  get editMode(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
  get setEditMode(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
  get setWindowSize(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get windowSize(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
});

export function useValUIContext() {
  return React.useContext(ValUIContext);
}
