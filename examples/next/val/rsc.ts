import "server-only";
import { initValRsc } from "@valbuild/next/rsc";
import { config } from "../val.config";
import valModules from "../val.modules";
import { cookies, draftMode, headers } from "next/headers";
import externalRecords from "./external";

const {
  fetchValStega: fetchVal,
  fetchValKeyStega: fetchValKey,
  fetchValRouteStega: fetchValRoute,
  fetchValRouteUrl,
  fetchValKeys,
  fetchValEntries,
} = initValRsc({ ...config, external: externalRecords }, valModules, {
  draftMode,
  headers,
  cookies,
});

export {
  fetchVal,
  fetchValKey,
  fetchValRoute,
  fetchValRouteUrl,
  // External records: `fetchVal` and `fetchValKey` above work on them too — a
  // reader must not have to change when content moves into a store. These two
  // are the additions, because no other storage mode has anything to page.
  fetchValKeys,
  fetchValEntries,
};
