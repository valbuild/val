import React, { Dispatch, SetStateAction } from "react";
import type { Remote } from "../utils/Remote";
import type { Session } from "../dto/Session";
import { ValApi } from "@valbuild/core";

export type Theme = "dark" | "light";
export type EditMode = "off" | "hover" | "window" | "full";
export type WindowSize = {
  width: number;
  height: number;
  innerHeight: number;
};

export const ValUIContext = React.createContext<{
  api: ValApi;
  session: Remote<Session>;
  editMode: EditMode;
  highlight: boolean;
  setHighlight: Dispatch<SetStateAction<boolean>>;
  setEditMode: Dispatch<SetStateAction<EditMode>>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setWindowSize: (size: WindowSize) => void;
  windowSize?: WindowSize;
}>({
  get api(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
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
  get highlight(): never {
    throw Error(
      "ValUIContext not found. Ensure components are wrapped by ValUIProvider!"
    );
  },
  get setHighlight(): never {
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
