import { Edit2, Edit3, Moon, Power, Sun } from "react-feather";
import { useValOverlayContext } from "./ValOverlayContext";
import { ValApi } from "@valbuild/react";

export function ValMenu({ api }: { api: ValApi }) {
  const { theme, setTheme, editMode, setEditMode } = useValOverlayContext();
  return (
    <div className="flex flex-row items-center justify-center w-full h-full space-x-4 text-primary">
      <button
        className="p-1 border rounded-full shadow bg-base border-highlight"
        onClick={() => {
          setEditMode((prev) => (prev === "off" ? "hover" : "off"));
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {editMode === "off" ? <Edit2 size={18} /> : <Edit3 size={18} />}
        </div>
      </button>
      <button
        className="p-1 border rounded-full shadow bg-base border-highlight"
        onClick={() => {
          setTheme(theme === "dark" ? "light" : "dark");
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {theme === "dark" && <Sun size={15} />}
          {theme === "light" && <Moon size={15} />}
        </div>
      </button>
      <a
        className="p-1 border rounded-full shadow bg-base border-highlight"
        href={api.getDisableUrl()}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          <Power size={18} />
        </div>
      </a>
    </div>
  );
}
