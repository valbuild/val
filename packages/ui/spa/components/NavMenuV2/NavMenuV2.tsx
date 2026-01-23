import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { DEFAULT_APP_HOST, SourcePath, ModuleFilePath } from "@valbuild/core";
import { Ellipsis, Loader2, Moon, Sun, LogOut, User } from "lucide-react";
import {
  useCurrentProfile,
  useValMode,
} from "../ValProvider";
import { useSchemaAtPath, useValConfig } from "../ValFieldProvider";
import { useTheme } from "../ValThemeProvider";
import { useValPortal } from "../ValPortalProvider";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../designSystem/popover";
import { ProfileImage } from "../ProfileImage";
import { fixCapitalization } from "../../utils/fixCapitalization";
import { useNavigation } from "../ValRouter";
import { useLayout } from "../Layout";
import { NavMenuData } from "./types";
import { SitemapSection } from "./SitemapSection";
import { ExplorerSection } from "./ExplorerSection";
import { ExternalButton } from "./ExternalButton";
import { Accordion, AccordionItem } from "../designSystem/accordion";
import { MOBILE_BREAKPOINT } from "../hooks/use-mobile";

export const NAV_MENU_V2_MOBILE_BREAKPOINT = MOBILE_BREAKPOINT;

export type NavMenuV2Props = {
  /** Navigation data */
  data: NavMenuData;
  /** Loading state */
  isLoading?: boolean;
  /** Called when a new page should be added */
  onAddPage?: (moduleFilePath: ModuleFilePath, urlPath: string) => void;
};

export function NavMenuV2({
  data,
  isLoading = false,
  onAddPage,
}: NavMenuV2Props) {
  const { currentSourcePath, navigate } = useNavigation();
  const layout = useLayout();
  const { theme, setTheme } = useTheme();
  const config = useValConfig();
  const portalContainer = useValPortal();
  const profile = useCurrentProfile();
  const mode = useValMode();
  const navRef = useRef<HTMLDivElement>(null);
  const schema = useSchemaAtPath(currentSourcePath);

  // Track if external is selected (not an accordion, just a button)
  const [isExternalSelected, setIsExternalSelected] = useState(false);
  // Track accordion open state (controlled)
  const [accordionValue, setAccordionValue] = useState<string | undefined>(
    undefined,
  );

  // Check if current path is external
  const isExternalPath = useMemo(() => {
    return (
      schema.status === "success" &&
      schema.data.type === "record" &&
      schema.data.router === "external-url-router"
    );
  }, [schema]);

  const isExplorerSection = useMemo(() => {
    return data.explorer && currentSourcePath.includes(data.explorer.name);
  }, [data.explorer, currentSourcePath]);

  const isSitemapSection = useMemo(() => {
    return data.sitemap && checkSitemapActive(data.sitemap, currentSourcePath);
  }, [data.sitemap, currentSourcePath]);

  // Update accordion value based on current path
  useEffect(() => {
    if (isExternalPath) {
      setAccordionValue("external");
    } else if (isSitemapSection) {
      setAccordionValue("sitemap");
    } else if (isExplorerSection) {
      setAccordionValue("explorer");
    }
  }, [isExternalPath, isSitemapSection, isExplorerSection]);

  const handleNavigate = useCallback(
    (sourcePath: string, isExternal = false) => {
      // Reset external selection when navigating to non-external paths
      if (!isExternal) {
        setIsExternalSelected(false);
      }
      navigate(sourcePath as SourcePath);
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        layout.navMenu.setOpen(false);
      }
    },
    [navigate, layout.navMenu],
  );

  const handleExternalClick = useCallback(() => {
    if (data.external) {
      // Close all accordion sections when external is selected
      setIsExternalSelected(true);
      handleNavigate(data.external.moduleFilePath as unknown as string, true);
    }
  }, [data.external, handleNavigate]);

  const handleAddPage = useCallback(
    (moduleFilePath: string, urlPath: string) => {
      if (onAddPage) {
        onAddPage(moduleFilePath as ModuleFilePath, urlPath);
      }
    },
    [onAddPage],
  );

  // Calculate max height for scrollable content
  const contentMaxHeight = useMemo(() => {
    // Total height of the menu is 100svh
    // Subtract:
    // - Header (64px / h-16)
    // - Profile section (56px)
    // - External button (48px) - if present
    // - Accordion triggers (48px * number of sections)

    let subtractHeight = 92 + 56; // base heights (header + profile)

    // Account for external button if present
    if (data.external) {
      subtractHeight += 48;
    }

    // Account for accordion triggers (sitemap and explorer)
    if (data.sitemap) subtractHeight += 48;
    if (data.explorer) subtractHeight += 48;

    return `calc(100svh - ${subtractHeight}px)`;
  }, [data.external, data.sitemap, data.explorer]);

  const appHostUrl = config?.appHost || DEFAULT_APP_HOST;

  return (
    <div ref={navRef} className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 h-16 flex items-center px-4">
        {config?.project && (
          <a
            href={`${appHostUrl}/~/${config.project}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-fg-secondary hover:text-fg-primary transition-colors"
          >
            {config.project}
          </a>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 size={20} className="animate-spin text-fg-secondary" />
          </div>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={accordionValue}
            onValueChange={setAccordionValue}
            className="shrink-0"
          >
            {/* Site Map Section */}
            {data.sitemap && (
              <SitemapSection
                sitemap={data.sitemap}
                currentPath={currentSourcePath}
                onNavigate={handleNavigate}
                onAddPage={handleAddPage}
                maxHeight={contentMaxHeight}
                portalContainer={portalContainer}
              />
            )}

            {/* External URLs Button - between Site Map and Explorer */}
            {data.external && (
              <AccordionItem value="external" onClick={handleExternalClick}>
                <ExternalButton
                  external={data.external}
                  isActive={isExternalSelected || isExternalPath}
                  onClick={handleExternalClick}
                />
              </AccordionItem>
            )}

            {/* Explorer Section */}
            {data.explorer && (
              <ExplorerSection
                explorer={data.explorer}
                currentPath={currentSourcePath}
                onNavigate={handleNavigate}
                maxHeight={contentMaxHeight}
              />
            )}
          </Accordion>
        )}
      </div>

      {/* Profile */}
      <div className="shrink-0 border-t border-border-primary">
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-3 w-full p-4 text-left hover:bg-bg-secondary transition-colors">
              {profile ? (
                <>
                  <ProfileImage profile={profile} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-fg-primary truncate">
                      {fixCapitalization(profile.fullName)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center">
                    <User size={16} className="text-fg-secondary" />
                  </div>
                  {mode === "http" && (
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-fg-secondary">
                        Not signed in
                      </div>
                    </div>
                  )}
                </>
              )}
              <Ellipsis size={16} className="text-fg-secondary shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            container={portalContainer}
            align="start"
            side="top"
            className="w-56"
          >
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary rounded-md transition-colors"
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              </button>
              {profile && config && (
                <a
                  href={`${appHostUrl}/logout`}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary rounded-md transition-colors"
                >
                  <LogOut size={16} />
                  <span>Sign out</span>
                </a>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/**
 * Recursively check if any item in the sitemap tree matches the current path
 */
function checkSitemapActive(
  item: NavMenuData["sitemap"],
  currentPath: string,
): boolean {
  if (!item) return false;

  if (item.sourcePath && currentPath.startsWith(item.sourcePath)) {
    return true;
  }

  for (const child of item.children) {
    if (checkSitemapActive(child, currentPath)) {
      return true;
    }
  }

  return false;
}
