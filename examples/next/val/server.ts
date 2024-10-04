import "server-only";
import { initValServer } from "@valbuild/next/server";
import { config } from "../val.config";
import { draftMode } from "next/headers";
import valModules from "../val.modules";
import prettier from "prettier";

const { valNextAppRouter } = initValServer(
  valModules,
  { ...config },
  {
    draftMode,
    formatter: (code, filePath) => {
      return prettier.format(code, {
        filepath: filePath,
      });
    },
  },
);

export { valNextAppRouter };
