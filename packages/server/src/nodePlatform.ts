import type { ValServerPlatform } from "./platform";
import {
  createValOps,
  readValLoginToken,
  resolveRemoteFileAuth,
} from "./valServerConfig";
import {
  decodeJwtWithoutVerifying,
  encodeJwt,
  getExpire,
  verifyJwt,
} from "./jwt";
import { probeUrl } from "./linkCheck/probeUrl";
import { checkModuleForStudio, fixForStudio } from "./studioValidation";

/** The platform every server on Node runs with. See {@link ValServerPlatform}. */
export const nodePlatform: ValServerPlatform = {
  createOps: createValOps,
  probeUrl: (url) => probeUrl(url),
  jwt: { verifyJwt, decodeJwtWithoutVerifying, encodeJwt, getExpire },
  bytesToBase64: (bytes) =>
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "base64",
    ),
  readValLoginToken,
  resolveRemoteFileAuth,
  studioValidation: { checkModuleForStudio, fixForStudio },
};
