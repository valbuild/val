import { initValClient } from "@valbuild/tanstack/client";
import { config } from "../../val.config";

/**
 * Val's hooks, for reading content in components.
 *
 * These work everywhere a component does — during SSR and in the browser.
 * On the server they resolve the published content; in a browser with the
 * Studio open they resolve what the editor currently has, so an edit shows up
 * without a round trip.
 */
const {
  useValStega: useVal,
  useValRouteStega: useValRoute,
  useValRouteUrl,
} = initValClient(config);

export { useVal, useValRoute, useValRouteUrl };
