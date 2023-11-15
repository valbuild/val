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

export const ValOverlayContext = React.createContext<{
  api: ValApi;
  session: Remote<Session | "not-authenticated">;
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
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get session(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get theme(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get setTheme(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get editMode(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get setEditMode(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get highlight(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
    );
  },
  get setHighlight(): never {
    throw Error(
      "ValOverlayContext not found. Ensure components are wrapped by ValOverlayProvider!"
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

export function useValOverlayContext() {
  return React.useContext(ValOverlayContext);
}
