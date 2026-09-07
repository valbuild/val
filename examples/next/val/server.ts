import "server-only";
import { initValServer } from "@valbuild/next/server";
import { config } from "../val.config";
import { draftMode } from "next/headers";
import valModules from "../val.modules";
import prettier from "prettier";
import externalRecords from "./external";

const { valNextAppRouter } = initValServer(
  valModules,
  // `external` is passed in rather than imported by a `.val.ts`: the adapters
  // pull in a database driver, and a `.val.ts` is evaluated in a `node:vm`
  // sandbox and bundled into the client.
  { ...config, external: externalRecords },
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
