import type { ValServerPlatform } from "../platform";
import { ValOpsMemory } from "../ValOpsMemory";
import { bytesToBase64 } from "../bytes";

const NO_SESSIONS =
  "Val: sessions are not available here -- this server runs in the browser, " +
  "has no secret to sign them with, and serves without authenticating.";

/**
 * The platform for a server running in a browser tab.
 *
 * Memory mode only: there is no filesystem for `fs` mode and no credential for
 * `http` mode. Everything else answers as a server without those things does
 * -- no `val login` token, no credential for remote files, no link checks --
 * and the session functions refuse, because a tab has no secret to sign with
 * and the server is constructed with `unsafelyAllowUnauthenticated`, so
 * nothing asks for one.
 */
export const browserPlatform: ValServerPlatform = {
  createOps: (valModules, options) => {
    if (options.mode !== "memory") {
      throw new Error(
        `Val: a server in the browser runs in memory mode, not '${options.mode}'.`,
      );
    }
    return new ValOpsMemory(valModules, {
      formatter: options.formatter,
      config: options.config,
      sourceFiles: options.sourceFiles,
      patchStore: options.patchStore,
      unsafelyAllowUnauthenticated: options.unsafelyAllowUnauthenticated,
      // Nothing can reach a server in a tab but the page it runs in.
      warnUnauthenticated: false,
      contentUrl: options.valContentUrl,
    });
  },
  probeUrl: async () => ({
    kind: "skipped",
    message: "Links are not checked in the browser.",
  }),
  jwt: {
    verifyJwt: () => ({
      success: false,
      reason: "missing-secret",
      message: NO_SESSIONS,
    }),
    decodeJwtWithoutVerifying: () => ({
      success: false,
      reason: "missing-secret",
      message: NO_SESSIONS,
    }),
    encodeJwt: () => {
      throw new Error(NO_SESSIONS);
    },
    getExpire: () => Math.floor(Date.now() / 1000) + 60 * 60,
  },
  bytesToBase64,
  readValLoginToken: async () => null,
  resolveRemoteFileAuth: async () => ({
    status: "error",
    errorCode: "api-key-missing",
    message: "Remote files are not available in the browser.",
  }),
};
