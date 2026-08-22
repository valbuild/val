import "server-only";
import { initValRsc } from "@valbuild/next/rsc";
import { config } from "../val.config";
import valModules from "../val.modules";
import { cookies, draftMode, headers } from "next/headers";

const {
  fetchValStega: fetchVal,
  fetchValKeyStega: fetchValKey,
  fetchValRouteStega: fetchValRoute,
  fetchValRouteUrl,
} = initValRsc(config, valModules, {
  draftMode,
  headers,
  cookies,
});

export { fetchVal, fetchValKey, fetchValRoute, fetchValRouteUrl };
