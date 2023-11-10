import { useValOverlayContext } from "./ValOverlayContext";
import { ValApi } from "@valbuild/core";
import classNames from "classnames";
import {
  Maximize,
  Minimize,
  Moon,
  Pause,
  Play,
  Power,
  Sun,
} from "lucide-react";
import React from "react";

const className = "p-1 border rounded-full shadow border-accent";
const PREV_URL_KEY = "valbuild:urlBeforeNavigation";

export function ValMenu({ api }: { api: ValApi }) {
  const { theme, setTheme, editMode, setEditMode } = useValOverlayContext();
  return (
    <div className="flex flex-row items-center justify-center w-full h-full px-1 py-2 border-2 rounded-full gap-x-3 text-primary bg-background border-fill">
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
          // Save the current url so we can go back to it when returning from fullscreen mode
          if (editMode !== "full") {
            localStorage.setItem(PREV_URL_KEY, window.location.href);
            window.location.href = api.getEditUrl();
          } else if (editMode === "full") {
            const prevUrl = localStorage.getItem(PREV_URL_KEY);
            window.location.href = prevUrl || "/";
          }
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {editMode === "full" ? (
            <Minimize size={15} />
          ) : (
            <Maximize size={15} />
          )}
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
        "bg-accent drop-shadow-[0px_0px_12px_rgba(56,205,152,0.60)]": active,
      })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
