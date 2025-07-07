import "client-only";
import { initValClient } from "@valbuild/next/client";
import { config } from "../val.config";

const { useValStega: useVal, useValRouteStega: useValRoute } =
  initValClient(config);

export { useVal, useValRoute };
