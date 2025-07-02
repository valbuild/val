import { NAV_MENU_MOBILE_BREAKPOINT, NavMenu } from "./NavMenu";
import { ToolsMenu } from "./ToolsMenu";
import { ContentArea } from "./ContentArea";
import classNames from "classnames";
import { useAuthenticationState, useTheme } from "./ValProvider";
import React, { useContext, useEffect, useState } from "react";
import { useNavigation } from "./ValRouter";
import { LoginDialog } from "./LoginDialog";

export function Layout() {
  const { theme } = useTheme();
  const [didInitialize, setDidInitialize] = useState(false);
  const [isNavMenuOpen, setIsNavMenuOpen] = useState(false);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const { currentSourcePath, ready: navigationReady } = useNavigation();
  useEffect(() => {
    if (!didInitialize && navigationReady) {
      if (window.innerWidth < NAV_MENU_MOBILE_BREAKPOINT) {
        if (!currentSourcePath) {
          setIsNavMenuOpen(true);
        }
        setDidInitialize(true);
      } else {
        setIsToolsMenuOpen(true);
        setIsNavMenuOpen(true);
        setDidInitialize(true);
      }
    }
  }, [didInitialize, navigationReady, currentSourcePath]);
  const authenticationState = useAuthenticationState();
  if (authenticationState === "login-required") {
    return (
      <div className="min-h-[100svh] bg-bg-primary">
        <LoginDialog />
      </div>
    );
  }
  return (
    <LayoutContext.Provider
      value={{
        navMenu: { isOpen: isNavMenuOpen, setOpen: setIsNavMenuOpen },
        toolsMenu: { isOpen: isToolsMenuOpen, setOpen: setIsToolsMenuOpen },
      }}
    >
      <main
        style={{
          visibility: "hidden",
          minHeight: "100svh",
          width: "100vw",
        }}
        id="val-app-container"
        className={classNames(
          "font-sans bg-bg-primary text-fg-primary grid grid-cols-1",
          {
            "xl:grid-cols-[320px,1fr,320px]": isNavMenuOpen && isToolsMenuOpen,
            "xl:grid-cols-[320px,1fr]": isNavMenuOpen && !isToolsMenuOpen,
            "xl:grid-cols-[1fr,320px]": !isNavMenuOpen && isToolsMenuOpen,
          },
        )}
        {...(theme ? { "data-mode": theme } : {})}
      >
        <div
          className={classNames({
            hidden: !isNavMenuOpen,
            "w-[min(320px,100vw)] border-r overflow-x-hidden border-border-primary fixed top-0 left-0 xl:relative xl:left-auto z-[41]":
              isNavMenuOpen,
          })}
        >
          <NavMenu />
        </div>
        <div>
          <ContentArea />
        </div>
        <div
          className={classNames({
            hidden: !isToolsMenuOpen,
            "w-[min(320px,100vw)] border-l border-border-primary fixed top-0 right-0 xl:relative xl:right-auto z-[42]":
              isToolsMenuOpen,
          })}
        >
          <div className="min-h-[100svh] bg-bg-primary">
            <ToolsMenu />
          </div>
        </div>
      </main>
    </LayoutContext.Provider>
  );
}

type LayoutContextValue = {
  navMenu: { isOpen: boolean; setOpen: (open: boolean) => void };
  toolsMenu: { isOpen: boolean; setOpen: (open: boolean) => void };
};
const LayoutContext = React.createContext<LayoutContextValue>(
  new Proxy(
    {},
    {
      get() {
        throw new Error("LayoutContext not provided");
      },
    },
  ) as LayoutContextValue,
);

export function useLayout() {
  return useContext(LayoutContext);
}
