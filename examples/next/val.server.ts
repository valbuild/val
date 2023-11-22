import { initValServer } from "@valbuild/next/server";
import { config } from "./val.config";
import { draftMode } from "next/headers";

const { createValApi } = initValServer(config, {
  draftMode,
});

export { createValApi };
