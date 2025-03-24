import { getSHA256Hash } from "../getSha256";
import { Buffer } from "buffer";

export function hashToRemoteFileHash(hash: string) {
  return hash.slice(
    0,
    12, // 12 hex characters = 6 bytes = 48 bits = 2^48 = 281474976710656 possibilities or 1 in 281474976710656 or using birthday problem estimate with 10K files: p = (k, n) => (k*k)/(2x2**n) and p(10_000,12*4) = 1.7763568394002505e-7 chance of collision which should be good enough
  );
}
export function getFileHash(text: Buffer) {
  return hashToRemoteFileHash(getSHA256Hash(new Uint8Array(text)));
}
