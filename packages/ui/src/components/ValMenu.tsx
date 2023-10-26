import { Edit2, Edit3, Maximize, Moon, Power, Sun } from "react-feather";
import { useValOverlayContext } from "./ValOverlayContext";
import { ValApi } from "@valbuild/core";

export function ValMenu({ api }: { api: ValApi }) {
  const { theme, setTheme, editMode, setEditMode } = useValOverlayContext();
  return (
    <div className="val-flex val-flex-row val-items-center val-justify-center val-w-full val-h-full val-space-x-4 val-text-primary">
      <button
        className="val-p-1 val-border val-rounded-full val-shadow val-bg-base val-border-highlight"
        onClick={() => {
          setEditMode((prev) => (prev === "off" ? "hover" : "off"));
        }}
      >
        <div className="val-h-[24px] val-w-[24px] val-flex val-justify-center val-items-center">
          {editMode === "hover" ? <Edit3 size={18} /> : <Edit2 size={18} />}
        </div>
      </button>
      <button
        className="val-p-1 val-border val-rounded-full val-shadow val-bg-base val-border-highlight"
        onClick={() => {
          setTheme(theme === "dark" ? "light" : "dark");
        }}
      >
        <div className="val-h-[24px] val-w-[24px] val-flex val-justify-center val-items-center">
          {theme === "dark" && <Sun size={15} />}
          {theme === "light" && <Moon size={15} />}
        </div>
      </button>
      <button
        className="val-p-1 val-border val-rounded-full val-shadow val-bg-base val-border-highlight"
        onClick={() => {
          setEditMode((prev) => (prev === "full" ? "off" : "full"));
        }}
      >
        <div className="val-h-[24px] val-w-[24px] val-flex val-justify-center val-items-center">
          <Maximize size={15} />
        </div>
      </button>
      <a
        className="val-p-1 val-border val-rounded-full val-shadow val-bg-base val-border-highlight"
        href={api.getDisableUrl()}
      >
        <div className="val-h-[24px] val-w-[24px] val-flex val-justify-center val-items-center">
          <Power size={18} />
        </div>
      </a>
    </div>
  );
}
