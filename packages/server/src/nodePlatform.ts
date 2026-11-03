import type { ValServerPlatform } from "./platform";
import { readValLoginToken, resolveRemoteFileAuth } from "./valServerConfig";
import { valRuntime } from "./valRuntime";
import {
  decodeJwtWithoutVerifying,
  encodeJwt,
  getExpire,
  verifyJwt,
} from "./jwt";
import { probeUrl } from "./linkCheck/probeUrl";
import { checkModuleForStudio, fixForStudio } from "./studioValidation";
import { loadTypeScriptKit } from "./patch/ts/loadTypeScriptKit";

/** The platform every server on Node runs with. See {@link ValServerPlatform}. */
export const nodePlatform: ValServerPlatform = {
  // One runtime per project in the process, and its data layer: see
  // `valRuntime`.
  createOps: (valModules, options) => valRuntime(valModules, options).ops,
  probeUrl: (url) => probeUrl(url),
  jwt: { verifyJwt, decodeJwtWithoutVerifying, encodeJwt, getExpire },
  bytesToBase64: (bytes) =>
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "base64",
    ),
  readValLoginToken,
  resolveRemoteFileAuth,
  studioValidation: { checkModuleForStudio, fixForStudio },
  typescript: loadTypeScriptKit,
};
