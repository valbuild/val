import "server-only";
import { initValServer } from "@valbuild/next/server";
import { config } from "../val.config";
import { draftMode } from "next/headers";

const { valNextAppRouter } = initValServer(
  { ...config },
  {
    draftMode,
  }
);

export { valNextAppRouter };
