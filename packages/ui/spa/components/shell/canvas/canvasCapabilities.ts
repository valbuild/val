import {
  bridgeAnswers,
  type CanvasBridgeInfo,
  type CanvasRequest,
} from "@valbuild/shared/internal";
/*
 * A default import for the reason `useShellVersions` gives: preconstruct's
 * JSON plugin has no named exports, and `VERSION` from `src/` is a build
 * placeholder in development.
 */
import uiPackageJson from "../../../../package.json";

/** What the page said in `ready` about what it answers. */
export type FrameBridge = {
  /** Absent from a bridge of a release before the list. */
  capabilities?: readonly string[];
  bridge?: CanvasBridgeInfo;
};

/** What the page cannot do, in the words of the error. */
const WHAT: Record<CanvasRequest, string> = {
  readPage: "be read from the Studio",
  screenshotPage: "be pictured from the Studio",
  readPageLog:
    "say what went wrong on it (its console errors and failed requests)",
  quickPreview: "show a quick preview",
  editInline: "be edited in place",
};

/**
 * Why the page will not answer `request`, or `null` when it will -- or when
 * it has not said yet (`bridge` is `null`: still loading), which is left to
 * the request's own timeout, as before.
 *
 * Said at once rather than after a timeout: a page whose bridge predates a
 * request never answers it, and waiting for that only to say "no answer" is
 * how the assistant used to spend five seconds learning nothing. The site
 * carries whatever binding it installed, so the error names that package and
 * the version to move to: the Studio's own, since `@valbuild/*` packages are
 * released together and a binding of the Studio's version answers everything
 * the Studio asks.
 */
export function unansweredRequestError(
  request: CanvasRequest,
  bridge: FrameBridge | null,
  studioVersion: string = uiPackageJson.version,
): string | null {
  if (bridge === null) return null;
  if (bridgeAnswers(bridge.capabilities, request)) return null;
  const installed = bridge.bridge;
  const target = `${studioVersion} or later (the Studio's version)`;
  if (installed === undefined) {
    return (
      `The page in the preview cannot ${WHAT[request]}: its Val package is older than the Studio. ` +
      `Update @valbuild/next or @valbuild/tanstack, whichever the site uses, to ${target}, then deploy the site (or restart its dev server).`
    );
  }
  const version = installed.version !== null ? ` ${installed.version}` : "";
  return (
    `The page in the preview cannot ${WHAT[request]}: it runs ${installed.package}${version}, which is older than the Studio. ` +
    `Update ${installed.package} to ${target}, then deploy the site (or restart its dev server).`
  );
}
