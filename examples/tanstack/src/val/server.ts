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
  fetchValDraft,
} = initValContent(config, valModules, { draftMode });

/**
 * Whether content analytics is on, for `<ValProvider analytics>`.
 *
 * On a hosted site this is a project setting, handed over as the
 * `VAL_ANALYTICS` secret, and the platform's own `val.server.ts` reads it.
 * The showcase sets the same variable in `.env.development`, which TanStack
 * Start loads into `process.env`, so it counts while you browse it in dev.
 */
const fetchValAnalytics = async () => process.env.VAL_ANALYTICS === "true";

export {
  valApiHandler,
  draftMode,
  fetchVal,
  fetchValKey,
  fetchValRoute,
  fetchValRouteUrl,
  fetchValDraft,
  fetchValAnalytics,
};
