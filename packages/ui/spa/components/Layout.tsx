import { NAV_MENU_MOBILE_BREAKPOINT, NavMenuWrapper } from "./NavMenu";
import { ToolsMenu } from "./ToolsMenu";
import { ContentArea } from "./ContentArea";
import { useAuthenticationState } from "./ValProvider";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { useNavigation } from "./ValRouter";
import { LoginDialog } from "./LoginDialog";
import {
  SidebarProvider,
  SidebarContent,
  SidebarRail,
  Sidebar,
} from "./designSystem/sidebar";
import { useIsMobile } from "./hooks/use-mobile";
import { Toaster } from "./designSystem/sonner";
import { TransientErrorToasts } from "./TransientErrorToasts";

export function Layout() {
  const isMobile = useIsMobile();
  const [didInitialize, setDidInitialize] = useState(false);
  const [isNavMenuOpen, setIsNavMenuOpenState] = useState(false);
  const [isToolsMenuOpen, setIsToolsMenuOpenState] = useState(false);
  const { currentSourcePath, ready: navigationReady } = useNavigation();
  useEffect(() => {
    if (!didInitialize && navigationReady) {
      if (window.innerWidth < NAV_MENU_MOBILE_BREAKPOINT) {
        setDidInitialize(true);
      } else {
        setIsToolsMenuOpenState(true);
        setIsNavMenuOpenState(true);
        setDidInitialize(true);
      }
    }
  }, [didInitialize, navigationReady, currentSourcePath]);
  const authenticationState = useAuthenticationState();
  // Both take the state to move to, rather than toggling: callers that need a
  // menu closed (a mobile sheet getting out of the way of the view it just
  // navigated to) have no way to express that with a toggle.
  const setNavMenuOpen = useCallback(
    (open: boolean) => {
      setIsNavMenuOpenState(open);
      if (open && isMobile) {
        // Only one sheet fits on a mobile screen
        setIsToolsMenuOpenState(false);
      }
    },
    [isMobile],
  );
  const setToolsMenuOpen = useCallback(
    (open: boolean) => {
      setIsToolsMenuOpenState(open);
      if (open && isMobile) {
        setIsNavMenuOpenState(false);
      }
    },
    [isMobile],
  );
  useEffect(() => {
    if (isMobile && isNavMenuOpen && isToolsMenuOpen) {
      setIsNavMenuOpenState(false);
    }
  }, [isMobile, isNavMenuOpen, isToolsMenuOpen]);
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
        navMenu: {
          isOpen: isNavMenuOpen,
          setOpen: setNavMenuOpen,
        },
        toolsMenu: {
          isOpen: isToolsMenuOpen,
          setOpen: setToolsMenuOpen,
        },
      }}
    >
      <main className="flex" style={{ height: "100svh", overflow: "hidden" }}>
        <SidebarProvider
          open={isNavMenuOpen}
          onOpenChange={setNavMenuOpen}
          className="hidden xl:block"
        >
          <Sidebar className="border-r-0" side="left">
            <SidebarContent>
              <NavMenuWrapper />
            </SidebarContent>
            <SidebarRail side="left" />
          </Sidebar>
        </SidebarProvider>
        <div className="grow w-full">
          <ContentArea />
        </div>
        <SidebarProvider
          open={isToolsMenuOpen}
          onOpenChange={setToolsMenuOpen}
          className="hidden xl:block"
        >
          <Sidebar className="border-l-0" side="right">
            <SidebarContent>
              <ToolsMenu />
            </SidebarContent>
            <SidebarRail side="right" />
          </Sidebar>
        </SidebarProvider>
      </main>
      <Toaster />
      <TransientErrorToasts />
    </LayoutContext.Provider>
  );
}

type LayoutContextValue = {
  navMenu: { isOpen: boolean; setOpen: (open: boolean) => void };
  toolsMenu: { isOpen: boolean; setOpen: (open: boolean) => void };
};

// No-op default value for when context is used outside of provider (e.g., Storybook)
const defaultLayoutValue: LayoutContextValue = {
  navMenu: { isOpen: false, setOpen: () => {} },
  toolsMenu: { isOpen: false, setOpen: () => {} },
};

const LayoutContext =
  React.createContext<LayoutContextValue>(defaultLayoutValue);

export function useLayout() {
  return useContext(LayoutContext);
}
