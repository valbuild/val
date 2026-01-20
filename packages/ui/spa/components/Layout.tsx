import { NAV_MENU_V2_MOBILE_BREAKPOINT, NavMenuV2Wrapper } from "./NavMenuV2";
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

export function Layout() {
  const isMobile = useIsMobile();
  const [didInitialize, setDidInitialize] = useState(false);
  const [isNavMenuOpen, setIsNavMenuOpenState] = useState(false);
  const [isToolsMenuOpen, setIsToolsMenuOpenState] = useState(false);
  const { currentSourcePath, ready: navigationReady } = useNavigation();
  useEffect(() => {
    if (!didInitialize && navigationReady) {
      if (window.innerWidth < NAV_MENU_V2_MOBILE_BREAKPOINT) {
        if (!currentSourcePath) {
          setIsNavMenuOpenState(true);
        }
        setDidInitialize(true);
      } else {
        setIsToolsMenuOpenState(true);
        setIsNavMenuOpenState(true);
        setDidInitialize(true);
      }
    }
  }, [didInitialize, navigationReady, currentSourcePath]);
  const authenticationState = useAuthenticationState();
  const setNavMenuOpen = useCallback(() => {
    setIsNavMenuOpenState((prev) => {
      if (isMobile) {
        setIsToolsMenuOpenState(false);
      }
      return !prev;
    });
  }, [isMobile, isToolsMenuOpen]);
  const setToolsMenuOpen = useCallback(() => {
    setIsToolsMenuOpenState((prev) => {
      if (isMobile) {
        setIsNavMenuOpenState(false);
      }
      return !prev;
    });
  }, [isMobile, isNavMenuOpen]);
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
      <main className="flex">
        <SidebarProvider
          open={isNavMenuOpen}
          onOpenChange={setNavMenuOpen}
          className="hidden xl:block"
        >
          <Sidebar className="border-r-0" side="left">
            <SidebarContent>
              <NavMenuV2Wrapper />
            </SidebarContent>
            <SidebarRail />
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

// No-op default value for when context is used outside of provider (e.g., Storybook)
const defaultLayoutValue: LayoutContextValue = {
  navMenu: { isOpen: false, setOpen: () => {} },
  toolsMenu: { isOpen: false, setOpen: () => {} },
};

const LayoutContext = React.createContext<LayoutContextValue>(defaultLayoutValue);

export function useLayout() {
  return useContext(LayoutContext);
}
