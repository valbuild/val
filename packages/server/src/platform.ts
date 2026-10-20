import type { ValModules } from "@valbuild/core";
import type { ValOpsFS } from "./ValOpsFS";
import type { ValOpsHttp } from "./ValOpsHttp";
import type { ValOpsMemory } from "./ValOpsMemory";
import type { ValServerConfig } from "./ValServer";
import type { ResolveRemoteFileAuthResult } from "./valServerConfig";
import type { JwtResult } from "./jwt";
import type { ProbeResult } from "./linkCheck/probeUrl";

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
  /** The developer's `val login` token. See `readValLoginToken`. */
  readValLoginToken: (options: ValServerConfig) => Promise<string | null>;
  /** Which credential talks to the content host. See `resolveRemoteFileAuth`. */
  resolveRemoteFileAuth: (
    options: ValServerConfig,
  ) => Promise<ResolveRemoteFileAuthResult>;
};
