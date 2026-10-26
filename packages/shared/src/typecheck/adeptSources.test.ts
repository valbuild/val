import { SourceError } from "./acquireTypes";
import { adeptSources } from "./adeptSources";

type Sent = { url: string; init: RequestInit | undefined };

function answering(status: number, body: string) {
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    sent.push({ url: String(input), init });
    return new Response(body, { status });
  };
  return { sent, fetch };
}

describe("adeptSources", () => {
  test("the Studio's way: its own origin, with the session cookie", async () => {
    const { sent, fetch } = answering(
      200,
      JSON.stringify({ files: { "index.d.ts": "export {}" }, stubs: [] }),
    );
    await adeptSources({ base: "/api/val/publish-api/adept", fetch }).types({
      name: "react",
      version: "19.3.0",
      integrity: "sha512-abc+def==",
    });
    expect(sent[0]?.url).toBe(
      "/api/val/publish-api/adept/types/public/react@19.3.0?integrity=sha512-abc%2Bdef%3D%3D",
    );
    expect(sent[0]?.init?.credentials).toBe("same-origin");
    expect(sent[0]?.init?.method).toBe("GET");
  });

  test("home's way: content directly, with the person's own credential and no cookies", async () => {
    const { sent, fetch } = answering(
      200,
      JSON.stringify({ version: "6.0.3", files: { "lib.d.ts": "" } }),
    );
    const compiler = await adeptSources({
      base: "https://content.val.build/v1/adept",
      fetch,
      headers: { Authorization: "Bearer a-token" },
      credentials: "omit",
    }).compiler("6.0.3");
    expect(compiler.version).toBe("6.0.3");
    expect(sent[0]?.url).toBe(
      "https://content.val.build/v1/adept/compiler/6.0.3",
    );
    expect(sent[0]?.init?.headers).toEqual({ Authorization: "Bearer a-token" });
    expect(sent[0]?.init?.credentials).toBe("omit");
  });

  test("adept's own error is the error, retryable as it says", async () => {
    const { fetch } = answering(
      503,
      JSON.stringify({
        error: { code: "busy", message: "adept is busy", retryable: true },
      }),
    );
    const failure = await adeptSources({ base: "/b", fetch })
      .types({ name: "zod", version: "4.1.0", integrity: null })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SourceError);
    expect(failure).toMatchObject({
      message: "adept is busy",
      code: "busy",
      retryable: true,
      status: 503,
    });
  });

  test("a gateway's page is not read as adept's answer: the status says it", async () => {
    const { fetch } = answering(502, "<html>Bad gateway</html>");
    const failure = await adeptSources({ base: "/b", fetch })
      .compiler("6.0.3")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: "TypeScript 6.0.3: The answer was 502.",
      code: "502",
      retryable: true,
    });
  });

  test("a deployment with nothing to ask is not worth asking again", async () => {
    const { fetch } = answering(
      501,
      JSON.stringify({ message: "No content service." }),
    );
    const failure = await adeptSources({ base: "/b", fetch })
      .compiler("6.0.3")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "501", retryable: false });
  });
});
