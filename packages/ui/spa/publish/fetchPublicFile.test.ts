import { fetchPublicFile, toBase64 } from "./fetchPublicFile";

describe("fetchPublicFile", () => {
  test("reads the path from this origin and answers base64", async () => {
    const asked: string[] = [];
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = await fetchPublicFile("val/a.png", async (url) => {
      asked.push(String(url));
      return new Response(bytes);
    });
    expect(asked).toEqual(["/val/a.png"]);
    expect(out).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("a file the site does not serve is an error, not an empty file", async () => {
    await expect(
      fetchPublicFile(
        "gone.png",
        async () => new Response("", { status: 404 }),
      ),
    ).rejects.toThrow(/404/);
  });

  test("an image-sized file does not overflow the stack", () => {
    const big = new Uint8Array(3_000_000).map((_, i) => i % 256);
    expect(toBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});
