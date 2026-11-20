import classNames from "classnames";
import { Ellipsis, Eye, Globe, LogIn, PanelsTopLeft, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Internal, ModuleFilePath, ModulePath } from "@valbuild/core";
import {
  useAuthenticationState,
  useCurrentPatchIds,
  useSiteHandoffState,
  useShallowModulesAtPaths,
  usePublishJobsState,
} from "./ValProvider";
import { ownPublishCard } from "../publish/ownPublishCard";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useValConfig, useSchemas } from "./ValFieldProvider";
import { useTheme } from "./ValThemeProvider";
import { useValPortal } from "./ValPortalProvider";
import { urlOf } from "@valbuild/shared/internal";
import { Popover, PopoverContent } from "./designSystem/popover";
import { PopoverTrigger } from "@radix-ui/react-popover";
import { CodeChangedCard } from "./shell/CodeChangedCard";
import { PublishHandoffCard } from "./shell/PublishHandoff";
import { AnimatedClock } from "./AnimatedClock";
import { OverlayMenuDivider, OverlayMenuLauncher } from "./shell/OverlayMenu";
import { OverlayMenuDock } from "./shell/OverlayMenuDock";
import { OverlaySettingsPanel } from "./shell/OverlaySettingsPanel";
import {
  DEFAULT_OVERLAY_PLACEMENT,
  LEGACY_STORAGE_KEY,
  OverlayPlacement,
  PLACEMENT_STORAGE_KEY,
  legacyDropZoneOf,
  parseStoredPlacement,
  placementOrientation,
} from "./shell/overlayPlacement";
import { ValLogo } from "./shell/ValLogo";

export type ValOverlayProps = {
  draftMode: boolean;
  draftModeLoading: boolean;
  /**
   * Modules the page could not show the Studio's content of, because it was
   * made with another schema than the page's build has: the page shows its
   * own for them, and the overlay says so with a reload (`CodeChangedCard`).
   */
  codeChanged?: readonly ModuleFilePath[];
  setDraftMode: (draftMode: boolean) => void;
  disableOverlay: () => void;
};

type ValMenuProps = ValOverlayProps & {
  loading: boolean;
  placement: OverlayPlacement;
  setPlacement: (placement: OverlayPlacement) => void;
};

export function ValOverlay(props: ValOverlayProps) {
  /*
   * `theme` as well as `resolvedTheme`: `theme === null` still means "nothing
   * has said what mode this is yet", which is what the menu shows its loading
   * state for. `resolvedTheme` is never null, because it is what gets stamped.
   */
  const { theme, resolvedTheme, themeStyle } = useTheme();
  const [placement, setPlacementRaw] = useState<OverlayPlacement | null>(null);
  const config = useValConfig();
  const projectKey =
    PLACEMENT_STORAGE_KEY + "-" + (config?.project || "unknown");
  useEffect(() => {
    try {
      /*
       * The project's own first, then whatever was used last anywhere. Each
       * is read in its current form, then as the dock name it was stored as
       * before the menu could be dragged freely, so nobody's menu moves on
       * upgrade.
       */
      const stored =
        (config && parseStoredPlacement(localStorage.getItem(projectKey))) ||
        parseStoredPlacement(localStorage.getItem(PLACEMENT_STORAGE_KEY)) ||
        (config &&
          parseStoredPlacement(
            localStorage.getItem(
              "val-menu-drop-zone-" + (config?.project || "unknown"),
            ),
          )) ||
        parseStoredPlacement(localStorage.getItem(LEGACY_STORAGE_KEY));
      setPlacementRaw(stored ?? DEFAULT_OVERLAY_PLACEMENT);
    } catch (e) {
      Internal.log.debug("Error getting menu placement from local storage", e);
      setPlacementRaw(DEFAULT_OVERLAY_PLACEMENT);
    }
  }, [config, projectKey]);
  const setPlacement = useCallback(
    (next: OverlayPlacement) => {
      setPlacementRaw(next);
      try {
        const json = JSON.stringify(next);
        localStorage.setItem(projectKey, json);
        localStorage.setItem(PLACEMENT_STORAGE_KEY, json);
        // The framework packages draw a loading circle before the Studio has
        // loaded, and know only the eight docks.
        localStorage.setItem(LEGACY_STORAGE_KEY, legacyDropZoneOf(next));
      } catch (e) {
        Internal.log.debug("Error setting menu placement to local storage", e);
      }
    },
    [projectKey],
  );

  return (
    <div
      data-mode={resolvedTheme}
      /*
       * The theme travels with `data-mode`, and this realm is the one where
       * it matters most: the outlines the canvas draws around editable
       * elements are `--bg-page-selection*`, which the accent moves.
       */
      style={themeStyle}
      id="val-overlay-container"
    >
      {placement !== null && (
        <ValMenu
          {...props}
          loading={theme === null}
          placement={placement}
          setPlacement={setPlacement}
        />
      )}
    </div>
  );
}

const buttonClassName =
  "inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors disabled:text-fg-disabled disabled:pointer-events-none";
const buttonInactiveClassName =
  "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary";

/** The side of a menu button that faces into the page, for its popovers. */
function sideFacingPage(
  placement: OverlayPlacement,
): "top" | "right" | "bottom" | "left" {
  switch (placement.edge) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

/**
 * The "⋯" menu: where the menu sits, light or dark, and leaving preview mode.
 */
function OverlaySettings({
  placement,
  onPlacementChange,
  draftMode,
  draftModeLoading,
  setDraftMode,
  side,
  open,
  onOpenChange,
}: {
  placement: OverlayPlacement;
  onPlacementChange: (placement: OverlayPlacement) => void;
  draftMode: boolean;
  draftModeLoading: boolean;
  setDraftMode: (draftMode: boolean) => void;
  side: "top" | "right" | "bottom" | "left";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const portalContainer = useValPortal();
  /*
   * `resolvedTheme`, so the switch shows the mode that is on screen. `theme`
   * can still be null here — nobody has chosen — while the project's own
   * default from `s.settings()` is what is being drawn.
   */
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="More"
        title="More"
        className={classNames(buttonClassName, buttonInactiveClassName, {
          "bg-bg-float-raised text-fg-primary": open,
        })}
      >
        <Ellipsis size={16} />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={10}
        container={portalContainer}
        className="z-[9003] w-60 p-1.5"
      >
        <OverlaySettingsPanel
          placement={placement}
          onPlacementChange={onPlacementChange}
          dark={resolvedTheme === "dark"}
          onDarkChange={(dark) => setTheme(dark ? "dark" : "light")}
          inPreview={draftMode}
          exitingPreview={draftModeLoading}
          onExitPreview={() => {
            onOpenChange(false);
            setDraftMode(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The menu over the user's page.
 *
 * Kept to what is worth a button on someone else's design: go to the Studio,
 * and turn Val off on this site (✕). Everything else is in "⋯" — where it
 * sits, light or dark, and leaving preview mode — because those are things
 * done once, not while editing. Out of preview mode it adds the way back in.
 * Editing happens in the Studio: the select mode, the edit window and the
 * chat window the overlay used to have are gone.
 *
 * ONE launcher for both modes. It used to be two, each in an `AnimateHeight`,
 * cross-fading their heights when preview mode changed — under a menu that
 * was itself animating its length — which is a large part of why it moved
 * oddly.
 */
function ValMenu({
  placement,
  setPlacement,
  draftMode,
  draftModeLoading,
  setDraftMode,
  disableOverlay,
  loading,
  codeChanged = [],
}: ValMenuProps) {
  const authenticationState = useAuthenticationState();
  // The "⋯" menu holds the bar open: it is portalled out of the bar, so
  // using it is leaving the bar.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const patchIds = useCurrentPatchIds();
  const validationErrors = useAllValidationErrors() || {};
  const validationErrorCount = Object.keys(validationErrors).length;
  const sourcePathResult = useValRouterSourcePathFromCurrentPathname();
  const handoff = useSiteHandoffState();
  /*
   * A publish this page made itself -- one of content alone, which opens no
   * builder tab -- has no tab's card to follow it, so it gets one of its own.
   */
  const publishJobsState = usePublishJobsState();
  const [dismissedPublishes, setDismissedPublishes] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const own =
    handoff.state === null
      ? ownPublishCard(publishJobsState, dismissedPublishes)
      : null;
  const popoverSide = sideFacingPage(placement);
  // Collapsed, the circle still has to say whether there is work outstanding.
  const launcherStatus: "none" | "changes" | "errors" =
    validationErrorCount > 0
      ? "errors"
      : patchIds.length > 0
        ? "changes"
        : "none";
  const inPreview = draftMode && !draftModeLoading;
  const pageInStudio =
    sourcePathResult.status === "success" && sourcePathResult.data
      ? sourcePathResult.data
      : "";
  const studioHref = window.origin + "/val/~" + pageInStudio;
  const studioIcon = pageInStudio ? (
    <Globe size={16} />
  ) : (
    <PanelsTopLeft size={16} />
  );
  const settings = (
    <OverlaySettings
      placement={placement}
      onPlacementChange={setPlacement}
      draftMode={draftMode}
      draftModeLoading={draftModeLoading}
      setDraftMode={setDraftMode}
      side={popoverSide}
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
    />
  );
  return (
    <>
      {codeChanged.length > 0 && (
        <div className={handoffCardPositionClassName(placement)}>
          <CodeChangedCard
            modules={codeChanged}
            onReload={() => window.location.reload()}
          />
        </div>
      )}
      {handoff.state !== null && (
        /*
         * A publish handed to a Studio tab, because this page cannot build.
         * Beside the dock rather than in a window: it is news about something
         * happening elsewhere, and editing carries on under it.
         */
        <div className={handoffCardPositionClassName(placement)}>
          <PublishHandoffCard
            state={handoff.state}
            onReload={() => window.location.reload()}
            onOpenStudio={handoff.openStudio}
            onDismiss={
              handoff.state.kind === "opening" ||
              handoff.state.kind === "running"
                ? undefined
                : handoff.dismiss
            }
          />
        </div>
      )}
      {own !== null && (
        <div className={handoffCardPositionClassName(placement)}>
          <PublishHandoffCard
            state={own.card}
            onReload={() => window.location.reload()}
            onBuildInTab={() => {
              // In the tap: only a tap may open a tab. It presses the same
              // request again, finds it pressed, and builds its job.
              handoff.prepare(true, {
                requestId: own.requestId,
                after: null,
              });
            }}
            onDismiss={
              own.card.kind === "publishing"
                ? undefined
                : () =>
                    setDismissedPublishes(
                      (prev) => new Set([...prev, own.requestId]),
                    )
            }
          />
        </div>
      )}
      <OverlayMenuDock
        placement={placement}
        onPlacementChange={setPlacement}
        className="z-[8999]"
      >
        {({ dragging }) =>
          // See ValNextProvider: the same circle is drawn there while the
          // Studio loads, so the menu does not appear from nowhere.
          loading ? (
            <div className="grid place-items-center w-[42px] h-[42px] rounded-full bg-bg-float border border-border-float text-fg-primary shadow-lg">
              <AnimatedClock size={16} />
            </div>
          ) : authenticationState === "login-required" ? (
            <a
              href={urlOf("/api/val/authorize", {
                redirect_to: window.location.href,
              })}
              aria-label="Sign in to Val"
              title="Sign in to Val"
              className="grid place-items-center w-[42px] h-[42px] rounded-full bg-bg-float border border-border-float text-fg-primary shadow-lg hover:bg-bg-float-raised"
            >
              <LogIn size={16} />
            </a>
          ) : (
            <OverlayMenuLauncher
              placement={placement}
              dragging={dragging}
              status={launcherStatus}
              mark={<ValMark />}
              holdOpen={settingsOpen}
            >
              {!inPreview && (
                <MenuButton
                  label="Enable preview mode"
                  disabled={draftModeLoading}
                  icon={
                    draftModeLoading ? (
                      <AnimatedClock size={16} />
                    ) : (
                      <Eye size={16} />
                    )
                  }
                  onClick={() => {
                    setDraftMode(true);
                  }}
                />
              )}
              <MenuButton
                label={
                  validationErrorCount > 0
                    ? `Open in Studio (${validationErrorCount} validation error${validationErrorCount === 1 ? "" : "s"})`
                    : patchIds.length > 0
                      ? `Open in Studio (${patchIds.length} pending change${patchIds.length === 1 ? "" : "s"})`
                      : "Open in Studio"
                }
                href={studioHref}
                icon={
                  // flex, so the icon does not sit on a text baseline and
                  // make this button taller than the others
                  <div className="flex relative">
                    <PendingChangesBadge
                      patchCount={patchIds.length}
                      validationErrorCount={validationErrorCount}
                    />
                    {studioIcon}
                  </div>
                }
              />
              {settings}
              <OverlayMenuDivider
                orientation={placementOrientation(placement)}
              />
              <MenuButton
                label="Turn off Val on this site"
                icon={<X size={16} />}
                onClick={() => disableOverlay()}
              />
            </OverlayMenuLauncher>
          )
        }
      </OverlayMenuDock>
    </>
  );
}

/** The Val mark, sized for the collapsed launcher. */
function ValMark() {
  return <ValLogo className="h-6" />;
}

function useValRouterSourcePathFromCurrentPathname() {
  const schemas = useSchemas();
  const allModuleFilePaths =
    "data" in schemas && schemas.data
      ? (Object.keys(schemas.data) as ModuleFilePath[])
      : [];
  const maybeRecordSources = useShallowModulesAtPaths(
    allModuleFilePaths,
    "record",
  );
  const [currentPathname, setCurrentPathname] = useState<string | null>(null);
  useEffect(() => {
    setCurrentPathname(window.location.pathname);
    const listener = () => {
      setCurrentPathname(window.location.pathname);
    };
    window.addEventListener("popstate", listener);
    const customEventListener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (
          typeof event.detail === "string" &&
          event.detail !== currentPathname
        ) {
          setCurrentPathname(event.detail);
        }
      }
    };
    window.addEventListener("val-provider:pathname", customEventListener);
    return () => {
      window.removeEventListener("popstate", listener);
      window.removeEventListener("val-provider:pathname", customEventListener);
    };
  }, []);
  const sourcePathResult = useMemo(() => {
    if (currentPathname) {
      for (const shallowModuleSource of maybeRecordSources.data || []) {
        for (const [fullPath, sourcePath] of Object.entries(
          shallowModuleSource,
        )) {
          if (fullPath === currentPathname) {
            const [moduleFilePath] =
              Internal.splitModuleFilePathAndModulePath(sourcePath);
            const schemasData =
              "data" in schemas ? schemas.data[moduleFilePath] : undefined;
            if (
              schemasData?.type === "record" &&
              schemasData.router !== undefined
            ) {
              return {
                status: "success",
                data: Internal.joinModuleFilePathAndModulePath(
                  moduleFilePath,
                  JSON.stringify(fullPath) as ModulePath,
                ),
              };
            }
          }
        }
      }
    }
    return {
      status: "not-found",
    };
  }, [schemas, maybeRecordSources, currentPathname]);
  return sourcePathResult;
}

/**
 * The counter on the compare button: how much there is to review. Shows the
 * number of validation errors in red when there are any, otherwise the number
 * of pending changes. Anything above 9 is shown as "9+" so the badge stays a
 * dot rather than growing with the count.
 *
 * Must be rendered inside a `relative` container.
 */
function PendingChangesBadge({
  patchCount,
  validationErrorCount,
}: {
  patchCount: number;
  validationErrorCount: number;
}) {
  const isError = validationErrorCount > 0;
  const count = isError ? validationErrorCount : patchCount;
  if (count === 0) {
    return null;
  }
  const noun = isError ? "validation error" : "pending change";
  return (
    <span
      aria-label={`${count} ${noun}${count === 1 ? "" : "s"}`}
      className={classNames(
        "absolute -top-2 -right-2 inline-flex justify-center items-center px-1 h-4 min-w-[1rem] text-[9px] font-medium leading-none rounded-full tabular-nums",
        // ring in the menu background color so the badge reads as a separate
        // dot on top of the button instead of blending into it
        "ring-2 ring-bg-float",
        {
          // A pending-change count is information, not a warning: it inverts to
          // the foreground colour rather than spending the brand hue on it.
          // Validation errors stay red, because they block publishing.
          "bg-fg-primary text-bg-float": !isError,
          "bg-bg-error-primary text-fg-error-primary": isError,
        },
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

const MenuButton = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  {
    icon: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    label?: string;
    href?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  } & React.HTMLAttributes<HTMLButtonElement | HTMLAnchorElement>
>(
  (
    {
      icon,
      onClick,
      disabled,
      active,
      label,
      href,
      onMouseEnter,
      onMouseLeave,
      ...rest
    },
    ref,
  ) => {
    const sharedClassName = classNames(buttonClassName, {
      "bg-bg-float-raised text-fg-primary": active,
      [buttonInactiveClassName]: !active,
    });

    if (href) {
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={sharedClassName}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          aria-label={label}
          title={label}
          {...rest}
        >
          {icon}
        </a>
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        disabled={disabled}
        className={sharedClassName}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-label={label}
        title={label}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
MenuButton.displayName = "MenuButton";

/**
 * Where the cards beside the menu sit: one step in from the edge the menu is
 * on, so they clear it wherever along that edge it is, and toward the same
 * end of the edge as the menu.
 */
function handoffCardPositionClassName(placement: OverlayPlacement): string {
  const base = "fixed z-[8999]";
  const third =
    placement.offset < 1 / 3
      ? "start"
      : placement.offset > 2 / 3
        ? "end"
        : "middle";
  switch (placement.edge) {
    case "left":
    case "right": {
      const across = placement.edge === "left" ? "left-20" : "right-20";
      const along =
        third === "start"
          ? "top-4"
          : third === "end"
            ? "bottom-4"
            : "top-1/2 -translate-y-1/2";
      return `${base} ${across} ${along}`;
    }
    case "top":
    case "bottom": {
      const across = placement.edge === "top" ? "top-20" : "bottom-20";
      const along =
        third === "start"
          ? "left-4"
          : third === "end"
            ? "right-4"
            : "left-1/2 -translate-x-1/2";
      return `${base} ${across} ${along}`;
    }
  }
}
