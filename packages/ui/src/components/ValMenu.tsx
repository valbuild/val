import {
  Edit2,
  Edit3,
  Maximize,
  Maximize2,
  Minimize,
  Minimize2,
  Moon,
  Pause,
  Play,
  Power,
  Sun,
} from "react-feather";
import { useValOverlayContext } from "./ValOverlayContext";
import { ValApi } from "@valbuild/core";
import classNames from "classnames";
import React from "react";

const className = "p-1 border rounded-full shadow bg-base border-highlight";

export function ValMenu({ api }: { api: ValApi }) {
  const { theme, setTheme, editMode, setEditMode } = useValOverlayContext();
  return (
    <div className="flex flex-row items-center justify-center w-full h-full gap-x-3 text-primary rounded-full bg-[#000] px-1 py-2 border-2 border-fill">
      <MenuButton
        active={editMode === "hover"}
        onClick={() => {
          setEditMode((prev) => (prev === "hover" ? "off" : "hover"));
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {editMode === "hover" ? <Pause size={18} /> : <Play size={18} />}
        </div>
      </MenuButton>
      <MenuButton
        onClick={() => {
          setTheme(theme === "dark" ? "light" : "dark");
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {theme === "dark" && <Sun size={15} />}
          {theme === "light" && <Moon size={15} />}
        </div>
      </MenuButton>
      <MenuButton
        active={editMode === "full"}
        onClick={() => {
          setEditMode((prev) => (prev === "full" ? "off" : "full"));
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {editMode === "full" && <Minimize2 size={15} />}
          {editMode !== "full" && <Maximize2 size={15} />}
        </div>
      </MenuButton>
      <a className={className} href={api.getDisableUrl()}>
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          <Power size={18} />
        </div>
      </a>
    </div>
  );
}

function MenuButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={classNames(className, {
        "bg-highlight drop-shadow-[0px_0px_12px_rgba(56,205,152,0.60)]": active,
      })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
