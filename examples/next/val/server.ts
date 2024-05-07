import "server-only";
import { initValServer } from "@valbuild/next/server";
import { config } from "../val.config";
import { draftMode } from "next/headers";
import valModules from "../val.modules";

const { valNextAppRouter } = initValServer(
  valModules,
  { ...config },
  {
    draftMode,
  }
);

export { valNextAppRouter };
