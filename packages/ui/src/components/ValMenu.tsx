import { useValUIContext } from "./ValUIContext";
import { ModuleId, ValApi } from "@valbuild/core";
import classNames from "classnames";
import {
  ExternalLink,
  LogIn,
  Maximize2,
  Minimize2,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Send,
  Sun,
} from "lucide-react";
import React, { MouseEventHandler, useEffect, useState } from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { PopoverTrigger } from "./ui/popover";

const className = "p-1 border rounded-full shadow border-accent";
const PREV_URL_KEY = "valbuild:urlBeforeNavigation";

type MenuDirection = "vertical" | "horizontal";

export function ValMenu({
  api,
  patches,
  direction,
  onClickPatches,
}: {
  api: ValApi;
  direction: MenuDirection;
  patches: Record<ModuleId, string[]>;
  onClickPatches: () => void;
}) {
  const { theme, setTheme, editMode, setEditMode, session } = useValUIContext();
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
  console.log({ patchCount });
  return (
    <MenuContainer direction={direction}>
      <MenuButton
        active={editMode === "hover" || editMode === "window"}
        onClick={() => {
          setEditMode((prev) =>
            prev === "hover" || editMode === "window" ? "off" : "hover"
          );
        }}
      >
        <div className="h-[24px] w-[24px] flex justify-center items-center">
          {editMode === "hover" || editMode === "window" ? (
            <Pause size={18} />
          ) : (
            <Play size={18} />
          )}
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
      {patchCount !== undefined && (
        <MenuButton
          onClick={() => {
            if (patchCount > 0) {
              onClickPatches();
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
      <PopoverTrigger className={className}>
        <div className="h-[24px] w-[24px]  flex justify-center items-center">
          <MoreHorizontal size={18}></MoreHorizontal>
        </div>
      </PopoverTrigger>
      <PopoverPrimitive.Content
        align={"start"}
        sideOffset={12}
        side="right"
        className={
          "z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
        }
      >
        <div className="flex flex-col items-start justify-center p-4 gap-x-4">
          <div className="flex items-end justify-end w-full">
            <div className="h-[34px] w-[34px] flex justify-center items-center">
              <SwitchPrimitives.Root
                className="relative peer inline-flex h-[24px] w-[34px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-slate-800 data-[state=unchecked]:bg-slate-800"
                defaultChecked={theme === "light"}
                onClick={() => {
                  setTheme(theme === "dark" ? "light" : "dark");
                }}
              >
                {theme === "dark" && (
                  <Moon
                    size={13}
                    className="absolute top-[4px] left-[17px] text-white"
                  />
                )}
                <SwitchPrimitives.SwitchThumb className="pointer-events-none block h-[16px] w-[16px] rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-0" />
                {theme === "light" && (
                  <Sun
                    size={13}
                    className="absolute top-[4px] left-[1px] text-white"
                  />
                )}
              </SwitchPrimitives.Root>
            </div>
          </div>
          <div>
            <a
              className="flex items-center justify-center font-bold h-[34px] gap-x-1"
              href={api.getDisableUrl(window.location.href)}
            >
              <span>Disable</span>
              <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </PopoverPrimitive.Content>
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
    <MenuContainer direction={direction} border={false}>
      <a className={className} href={href}>
        <div className="flex items-center justify-center px-2 gap-y-2">
          {children}
        </div>
      </a>
    </MenuContainer>
  );
}

function MenuContainer({
  children,
  direction,
  border = true,
}: {
  children: React.ReactNode | React.ReactNode[];
  direction: MenuDirection;
  border?: boolean;
}) {
  return (
    <div
      className={classNames(
        "flex justify-center w-full h-full px-2 py-2 font-sans rounded-full gap-3 text-primary border-fill bg-gradient-to-br from-background/90 from-40% to-background backdrop-blur-lg drop-shadow-2xl",
        {
          "flex-col items-start": direction === "vertical",
          "flex-row items-center": direction === "horizontal",
        },
        {
          border: border,
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
  onClick?: MouseEventHandler<HTMLButtonElement>;
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
