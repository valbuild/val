import "server-only";
import { initValMcp } from "@valbuild/next/server";
import { createValImageTools } from "@valbuild/mcp";
import { sharpImageProcessor } from "@valbuild/mcp/sharp";
import { config } from "../val.config";
import valModules from "../val.modules";
import prettier from "prettier";
import sharp from "sharp";

/**
 * Val's tools, ready to mount on an MCP transport.
 *
 * Separate from `val/server.ts` because the two share nothing but the modules:
 * the API router serves the Studio in a browser, and this serves an agent that
 * has none. The formatter is passed to both for the same reason — a patch
 * written to disk in local dev should come out formatted the way the repo
 * formats everything else, whichever path wrote it.
 */
const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
  valModules,
  config,
  {
    /**
     * The image tool, which this app opts into by installing `sharp`.
     *
     * Passed in rather than bundled, because `sharp` is a native dependency and
     * a CMS should not put a compiled binary in every project that installs it.
     * Leave this out and the agent can still read, validate and edit content —
     * it just cannot add an image.
     */
    extraTools: createValImageTools(sharpImageProcessor(sharp)),
    formatter: (code, filePath) => {
      return prettier.format(code, {
        filepath: filePath,
      });
    },
    /**
     * Where to authorize, when this app is configured for it.
     *
     * Read from the environment rather than hardcoded, and absent by default,
     * because the two are genuinely different deployments: local development
     * has no authorization server to talk to and wants the endpoint to work
     * without one, while a deployed app must not serve MCP to whoever asks.
     * Set both and every call needs a verified access token.
     */
    ...(process.env.VAL_OAUTH_ISSUER && process.env.VAL_MCP_RESOURCE
      ? {
          oauth: {
            issuer: process.env.VAL_OAUTH_ISSUER,
            resource: process.env.VAL_MCP_RESOURCE,
          },
        }
      : {}),
  },
);

export { valMcpAuthorize, valMcpTools, valMcpMetadata };
