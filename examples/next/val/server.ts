import "server-only";
import { initValServer, createPrettierFormatter } from "@valbuild/next/server";
import { config } from "../val.config";
import { draftMode } from "next/headers";
import valModules from "../val.modules";
import prettier from "prettier";

const { valNextAppRouter } = initValServer(
  valModules,
  { ...config },
  {
    draftMode,
    /**
     * The project's own formatting, not prettier's defaults.
     *
     * `prettier.format(code, { filepath })` — which this used to be, and which
     * is the obvious thing to write — never reads `.prettierrc`: `filepath`
     * only picks the parser. `createPrettierFormatter` resolves the config and
     * `.prettierignore` for each file, and is the same function
     * `val validate --fix` uses, so the Studio and the CLI cannot disagree.
     */
    formatter: createPrettierFormatter(prettier, {
      projectRoot: process.cwd(),
    }),
  },
);

export { valNextAppRouter };
