import { MouseEvent, useCallback } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  useNavigation,
  VAL_COMPARE_ROUTE,
  VAL_ERRORS_ROUTE,
} from "./ValRouter";

/** Anywhere the studio's own router can go. */
export type NavTarget =
  | SourcePath
  | ModuleFilePath
  | typeof VAL_COMPARE_ROUTE
  | typeof VAL_ERRORS_ROUTE;

export type NavLinkParams = {
  scrollToPath?: SourcePath | ModuleFilePath;
  errorFields?: SourcePath[];
};

/** What to spread onto an `<a>` so it navigates in-app but behaves like a link. */
export type NavLinkProps = {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * Make something the user can click a real link.
 *
 * Every in-studio destination used to be a `<button onClick={navigate}>`, which
 * gives up everything a browser knows how to do with a destination: no
 * middle-click into a new tab, no "Copy link address", no destination in the
 * status bar on hover, and nothing for a screen reader to announce as a link.
 * The URL comes from `hrefOf`, the same function `navigate` uses, so the href
 * and the click cannot drift apart.
 *
 * The click handler claims only the plain left click. Modified clicks —
 * cmd/ctrl (new tab), shift (new window), alt (download), middle button — are
 * left to the browser, which is the entire reason for using an anchor.
 */
export function useNavLink(
  to: NavTarget,
  params?: NavLinkParams,
): NavLinkProps {
  const { navigate, hrefOf } = useNavigation();
  const scrollToPath = params?.scrollToPath;
  const errorFields = params?.errorFields;
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(to, { scrollToPath, errorFields });
    },
    [navigate, to, scrollToPath, errorFields],
  );
  return { href: hrefOf(to, { scrollToPath, errorFields }), onClick };
}
