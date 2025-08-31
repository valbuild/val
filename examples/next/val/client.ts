import "client-only";
import { initValClient } from "@valbuild/next/client";
import { config } from "../val.config";

const {
  useValStega: useVal,
  useValRouteStega: useValRoute,
  useValRouteUrl,
} = initValClient(config);

export { useVal, useValRoute, useValRouteUrl };
