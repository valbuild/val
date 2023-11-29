import "server-only";
import { initValRsc } from "@valbuild/next/rsc";
import { config } from "../val.config";
import { draftMode, headers } from "next/headers";

const { fetchValStega: fetchVal } = initValRsc(config, {
  draftMode,
  headers,
});

export { fetchVal };
