import { NAV_MENU_MOBILE_BREAKPOINT, NavMenu } from "./NavMenu";
import { ToolsMenu } from "./ToolsMenu";
import { ContentArea } from "./ContentArea";
import { useAuthenticationState, useTheme } from "./ValProvider";
import React, { useContext, useEffect, useState } from "react";
import { useNavigation } from "./ValRouter";
import { LoginDialog } from "./LoginDialog";
import {
  SidebarProvider,
  SidebarContent,
  SidebarRail,
  Sidebar,
} from "./designSystem/sidebar";

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
      <main className="flex">
        <SidebarProvider
          open={isNavMenuOpen}
          onOpenChange={setIsNavMenuOpen}
          className="hidden lg:block"
        >
          <Sidebar className="border-r-0" side="left">
            <SidebarContent>
              <NavMenu />
            </SidebarContent>
            <SidebarRail />
          </Sidebar>
        </SidebarProvider>
        <div className="grow w-full">
          <ContentArea />
        </div>
        <SidebarProvider
          open={isToolsMenuOpen}
          onOpenChange={setIsToolsMenuOpen}
          className="hidden lg:block"
        >
          <Sidebar className="border-l-0" side="right">
            <SidebarContent>
              <ToolsMenu />
            </SidebarContent>
            <SidebarRail />
          </Sidebar>
        </SidebarProvider>
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
