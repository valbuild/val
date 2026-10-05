import { Internal } from "@valbuild/core";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  test("without crypto.subtle, hashes in chunks to the same hash", async () => {
    // jest is not a secure context, so this is the fallback.
    expect(globalThis.isSecureContext).not.toBe(true);
    const bytes = new Uint8Array(new ArrayBuffer(2.5 * 1024 * 1024 + 7));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 31) % 251;
    }
    expect(await sha256Hex(bytes)).toBe(Internal.getSHA256Hash(bytes));
    const empty = new Uint8Array(new ArrayBuffer(0));
    expect(await sha256Hex(empty)).toBe(Internal.getSHA256Hash(empty));
  });
});
