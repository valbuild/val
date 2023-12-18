import { result } from "@valbuild/core/fp";
import { useValOverlayContext } from "./ValOverlayContext";
import { ModuleId, ValApi } from "@valbuild/core";
import classNames from "classnames";
import {
  LogIn,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  Power,
  Send,
  Sun,
} from "lucide-react";
import React, { useEffect, useState } from "react";

const className = "p-1 border rounded-full shadow border-accent";
const PREV_URL_KEY = "valbuild:urlBeforeNavigation";

type MenuDirection = "vertical" | "horizontal";

export function ValMenu({
  api,
  patches,
  direction,
  onCommit,
}: {
  api: ValApi;
  direction: MenuDirection;
  patches: Record<ModuleId, string[]>;
  onCommit: () => void;
}) {
  const { theme, setTheme, editMode, setEditMode, session } =
    useValOverlayContext();
  if (session.status === "success" && session.data.mode === "unauthorized") {
    return (
      <SingleItemMenu
        direction={direction}
        href={api.getLoginUrl(window.location.href)}
      >
        <span>Login</span>
        <LogIn size={18} />
      </SingleItemMenu>
    );
  }
  if (session.status === "success" && !session.data.enabled) {
    return (
      <SingleItemMenu
        direction={direction}
        href={api.getEnableUrl(window.location.href)}
      >
        <span>Enable</span>
        <LogIn size={18} />
      </SingleItemMenu>
    );
  }
  const [patchCount, setPatchCount] = useState<number>();

  useEffect(() => {
    let patchCount = 0;
    for (const moduleId in patches) {
      patchCount += patches[moduleId as ModuleId].length;
    }
    setPatchCount(patchCount);
  }, [patches]);

  return (
    <MenuContainer direction={direction}>
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
            <Minimize2 size={15} />
          ) : (
            <Maximize2 size={15} />
          )}
        </div>
      </MenuButton>
      {patchCount !== undefined &&
        session.status === "success" &&
        session.data.mode === "proxy" && (
          <MenuButton
            onClick={() => {
              if (patchCount > 0) {
                api.postCommit({ patches }).then((res) => {
                  if (result.isErr(res)) {
                    console.error(res.error);
                    alert("Could not commit patches: " + res.error.message);
                  } else {
                    console.log("Committed patches: ", res.value);
                    onCommit();
                  }
                });
              } else {
                alert("No patches to commit");
              }
            }}
          >
            <div className="relative h-[24px] w-[24px] flex justify-center items-center">
              <div className="absolute -right-[10px] -top-[10px] border border-border rounded-full px-1 font-sans text-xs bg-card text-accent">
                {patchCount}
              </div>
              <Send size={18} />
            </div>
          </MenuButton>
        )}
      <a className={className} href={api.getDisableUrl(window.location.href)}>
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          <Power size={18} />
        </div>
      </a>
    </MenuContainer>
  );
}

function SingleItemMenu({
  href,
  direction,
  children,
}: {
  href: string;
  direction: MenuDirection;
  children: React.ReactNode[];
}) {
  return (
    <div
      className={classNames(
        "flex items-start justify-center w-full h-full font-sans border rounded-full gap-3 text-primary border-fill bg-gradient-to-br from-background/90 from-40% to-background backdrop-blur-lg drop-shadow-2xl",
        {
          "flex-col items-start": direction === "vertical",
          "flex-row items-center": direction === "horizontal",
        }
      )}
    >
      <a className={className} href={href}>
        <div className="flex items-center justify-center px-2 gap-y-2">
          {children}
        </div>
      </a>
    </div>
  );
}

function MenuContainer({
  children,
  direction,
}: {
  children: React.ReactNode | React.ReactNode[];
  direction: MenuDirection;
}) {
  return (
    <div
      className={classNames(
        "flex justify-center w-full h-full px-2 py-2 font-sans border rounded-full gap-3 text-primary border-fill bg-gradient-to-br from-background/90 from-40% to-background backdrop-blur-lg drop-shadow-2xl",
        {
          "flex-col items-start": direction === "vertical",
          "flex-row items-center": direction === "horizontal",
        }
      )}
    >
      {children}
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
        "bg-accent text-accent-foreground drop-shadow-[0px_0px_12px_hsl(var(--accent))]":
          active,
      })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
