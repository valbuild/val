import {
  initValServer,
  initValContent,
  createPrettierFormatter,
} from "@valbuild/tanstack/server";
import prettier from "prettier";
import { config } from "../../val.config";
import valModules from "../../val.modules";

/**
 * The Val API and the server-side content readers.
 *
 * Built together so they share ONE draft-mode object: the API is what turns
 * preview on for a browser, and the readers are what has to notice. Two
 * independently-created defaults would both work and disagree.
 */
const { valApiHandler, draftMode } = initValServer(
  valModules,
  { ...config },
  {
    /**
     * The project's own formatting, not prettier's defaults.
     *
     * `prettier.format(code, { filepath })` never reads `.prettierrc` —
     * `filepath` only picks the parser. `createPrettierFormatter` resolves the
     * config and `.prettierignore` per file, and is what `val validate --fix`
     * runs too, so an edit saved here and a fix applied there come out the same.
     */
    formatter: createPrettierFormatter(prettier, {
      projectRoot: process.cwd(),
    }),
  },
);

const {
  fetchValStega: fetchVal,
  fetchValKeyStega: fetchValKey,
  fetchValRouteStega: fetchValRoute,
  fetchValRouteUrl,
} = initValContent(config, valModules, { draftMode });

export {
  valApiHandler,
  draftMode,
  fetchVal,
  fetchValKey,
  fetchValRoute,
  fetchValRouteUrl,
};
