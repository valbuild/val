import { initValRsc } from "@valbuild/next/rsc";
import { config } from "../val.config";
import { draftMode, headers } from "next/headers";

const { fetchVal } = initValRsc(config, {
  draftMode,
  headers,
});

export { fetchVal };