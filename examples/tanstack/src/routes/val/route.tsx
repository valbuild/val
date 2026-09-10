import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ValApp, ValModulesClient } from "@valbuild/tanstack";
import { config } from "../../../val.config";
import valModules from "../../../val.modules";

/**
 * Val Studio, at `/val`.
 *
 * A layout route rather than a leaf, because the Studio navigates within
 * itself: it pushes paths like `/val/~/...`, so the segment and everything
 * under it have to resolve to this same page. `index.tsx` and `$.tsx` beside
 * this file render nothing — they exist so those URLs match.
 *
 * Deliberately outside the site's own chrome: `__root` is the shell for every
 * route including this one, so keep anything the Studio should not be wrapped
 * in (a site header, a `ValProvider` overlay) out of it, or in a layout of its
 * own.
 */
export const Route = createFileRoute("/val")({
  component: ValStudio,
});

function ValStudio() {
  return (
    <ValApp config={config}>
      <ValModulesClient modules={valModules} />
      <Outlet />
    </ValApp>
  );
}
