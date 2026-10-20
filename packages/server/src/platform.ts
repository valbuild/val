import type { ValModules } from "@valbuild/core";
import type { ValOpsFS } from "./ValOpsFS";
import type { ValOpsHttp } from "./ValOpsHttp";
import type { ValOpsMemory } from "./ValOpsMemory";
import type { ValServerConfig } from "./ValServer";
import type { ResolveRemoteFileAuthResult } from "./valServerConfig";
import type { JwtResult } from "./jwt";
import type { ProbeResult } from "./linkCheck/probeUrl";
import type { checkModuleForStudio, fixForStudio } from "./studioValidation";

/**
 * What `ValServer` needs from the machine it runs on.
 *
 * Everything else in `ValServer` is request handling, and runs anywhere. These
 * are the parts that reach for Node -- a filesystem, a socket, a keyed hash --
 * and they are passed in rather than imported so that the same server can run
 * in a browser tab: the demo (`@valbuild/server/browser`) serves a memory-mode
 * server to the Studio with no network in between.
 *
 * `nodePlatform` is the real one, and `createValServer` passes it. A function
 * here is whatever an implementation can honestly answer: the browser one has
 * no filesystem to read a token from, so it answers as a server without one
 * does.
 */
export type ValServerPlatform = {
  /** Builds the data layer the config asks for. See `createValOps`. */
  createOps: (
    valModules: ValModules,
    options: ValServerConfig,
  ) => ValOpsFS | ValOpsHttp | ValOpsMemory;
  /** Whether an external URL answers. See `linkCheck/probeUrl`. */
  probeUrl: (url: string) => Promise<ProbeResult>;
  /** The session cookie's signature. See `jwt.ts`. */
  jwt: {
    verifyJwt: (token: string, secretKey: string) => JwtResult;
    decodeJwtWithoutVerifying: (token: string) => JwtResult;
    encodeJwt: (payload: object, sessionKey: string) => string;
    getExpire: () => number;
  };
  /**
   * `bytes` as base64. For the paths that encode every file a publish commits:
   * Node's `Buffer` is ten times faster than `btoa`, and a browser has only
   * `btoa` (`bytesToBase64` in `bytes.ts`). Same answer either way.
   */
  bytesToBase64: (bytes: Uint8Array) => string;
  /** The developer's `val login` token. See `readValLoginToken`. */
  readValLoginToken: (options: ValServerConfig) => Promise<string | null>;
  /** Which credential talks to the content host. See `resolveRemoteFileAuth`. */
  resolveRemoteFileAuth: (
    options: ValServerConfig,
  ) => Promise<ResolveRemoteFileAuthResult>;
  /**
   * The Studio's full check (`/validate`, `/validate/fix`). It reads files'
   * bytes and asks remote hosts, so it needs Node; absent in a browser, where
   * both routes answer that it is not available.
   */
  studioValidation?: {
    checkModuleForStudio: typeof checkModuleForStudio;
    fixForStudio: typeof fixForStudio;
  };
};
