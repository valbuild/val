import { initValServer, initValContent } from "@valbuild/tanstack/server";
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
    formatter: (code, filePath) =>
      prettier.format(code, { filepath: filePath }),
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
