import "server-only";
import { initValRsc } from "@valbuild/next/rsc";
import { config } from "../val.config";
import { cookies, draftMode, headers } from "next/headers";

const { fetchValStega: fetchVal } = initValRsc(config, {
  draftMode,
  headers,
  cookies,
});

export { fetchVal };
