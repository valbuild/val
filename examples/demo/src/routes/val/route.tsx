import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ValApp, ValModulesClient } from "@valbuild/tanstack";
import { config } from "../../../val.config";
import valModules from "../../../val.modules";
import { isDemo } from "../../demo";

/**
 * Val Studio, at `/val`. In the demo, `ValApp` starts Val's server in this
 * tab and the Studio talks to it there: no sign-in, no network.
 */
export const Route = createFileRoute("/val")({
  component: ValStudio,
});

function ValStudio() {
  return (
    <ValApp config={config} demo={isDemo}>
      <ValModulesClient modules={valModules} />
      <Outlet />
    </ValApp>
  );
}
