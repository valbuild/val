import {
  initValServer,
  initValContent,
  createPrettierFormatter,
  type ValAnalytics,
  type ValHttpMode,
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
/**
 * For Val's own end-to-end suite (`e2e/proposal/`), never for an app: this
 * server at the address of a PROPOSAL, which on Val's hosting the platform
 * says with its own `val.server.ts`. A proposal with nothing saved in it, on
 * the content host the suite's mock stands in for.
 */
const e2eProposal = process.env.VAL_E2E_PROPOSAL;
const e2eHttp: ValHttpMode | undefined =
  e2eProposal && process.env.VAL_API_KEY && process.env.VAL_SECRET
    ? {
        apiKey: process.env.VAL_API_KEY,
        valSecret: process.env.VAL_SECRET,
        proposal: {
          name: e2eProposal,
          branch: `val/p/${e2eProposal}`,
          commit: null,
          modules: {},
          files: {},
        },
      }
    : undefined;

const { valApiHandler, draftMode } = initValServer(
  valModules,
  { ...config },
  {
    ...(e2eHttp !== undefined ? { http: e2eHttp } : {}),
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
} = initValContent(config, valModules, {
  draftMode,
  ...(e2eHttp !== undefined ? { http: e2eHttp } : {}),
});

/**
 * Content analytics, for `<ValProvider analytics>`: whether it is on, and the
 * content version the page is rendered from.
 *
 * On a hosted site both come from the platform -- the project setting as the
 * `VAL_ANALYTICS` secret, the served version's id as `VAL_CONTENT_VERSION` --
 * and the platform's own `val.server.ts` reads them. The showcase sets the
 * same variables in `.env.development`, which TanStack Start loads into
 * `process.env`, so it counts while you browse it in dev.
 */
const fetchValAnalytics = async (): Promise<ValAnalytics> => {
  const contentVersion = process.env.VAL_CONTENT_VERSION;
  return {
    enabled: process.env.VAL_ANALYTICS === "true",
    ...(contentVersion ? { contentVersion } : {}),
  };
};

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
