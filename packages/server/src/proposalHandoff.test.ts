import {
  HANDOFF_KEY_CONTEXT,
  sealProposalHandoff,
  type ProposalHandoff,
} from "./proposalHandoff";

/**
 * The loader at a proposal's address opens a handoff with WebCrypto
 * (valbuild/home `platform/packages/loader/src/proposalHandoff.ts`), so this
 * opens it the same way: a format that drifted on this side would be a sign-in
 * through Val Build again, silently, rather than a failure anyone saw.
 */
async function openLikeTheLoader(
  token: string,
  valSecret: string,
): Promise<ProposalHandoff | null> {
  const bytes = Buffer.from(token, "base64url");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(HANDOFF_KEY_CONTEXT + valSecret),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) },
      key,
      bytes.subarray(12),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

describe("sealProposalHandoff", () => {
  const handoff = {
    aud: "https://0123456789abcdef0123--blog.valstart.dev",
    exp: 1_900_000_000,
    session: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30=.c2ln",
  };

  test("opens with WebCrypto, as the loader opens it", async () => {
    const token = sealProposalHandoff(handoff, "secret");
    expect(await openLikeTheLoader(token, "secret")).toEqual({
      v: 1,
      ...handoff,
    });
  });

  test("hides the session: it is not readable in the token", () => {
    const token = sealProposalHandoff(handoff, "secret");
    expect(Buffer.from(token, "base64url").toString("latin1")).not.toContain(
      "eyJhbGci",
    );
  });

  test("does not open with another project's secret", async () => {
    const token = sealProposalHandoff(handoff, "secret");
    expect(await openLikeTheLoader(token, "another")).toBeNull();
  });

  test("does not open once changed", async () => {
    const token = sealProposalHandoff(handoff, "secret");
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 20] ^= 1;
    expect(
      await openLikeTheLoader(bytes.toString("base64url"), "secret"),
    ).toBeNull();
  });
});
