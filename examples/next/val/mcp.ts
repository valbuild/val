import "server-only";
import { initValMcp } from "@valbuild/next/server";
import { config } from "../val.config";
import valModules from "../val.modules";
import prettier from "prettier";

/**
 * Val's tools, ready to mount on an MCP transport.
 *
 * Separate from `val/server.ts` because the two share nothing but the modules:
 * the API router serves the Studio in a browser, and this serves an agent that
 * has none. The formatter is passed to both for the same reason — a patch
 * written to disk in local dev should come out formatted the way the repo
 * formats everything else, whichever path wrote it.
 */
const { valMcpAuthorize, valMcpTools } = initValMcp(valModules, config, {
  formatter: (code, filePath) => {
    return prettier.format(code, {
      filepath: filePath,
    });
  },
});

export { valMcpAuthorize, valMcpTools };
