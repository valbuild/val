import {
  initVal,
  Internal,
  MediaSource,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import {
  checkRemoteFiles,
  clearRemoteFileAnswers,
  type HeadRemoteFile,
  type RemoteFileAnswer,
  type RemoteFilesCheckInput,
} from "./remoteFileCheck";

const { s } = initVal();
const IMAGE: SerializedSchema = s.image().remote()["executeSerialize"]();
const HOST = "https://files.example.com";
const OTHER_HOST = "https://other.example.com";
const VERSION = "1.0.0";
const textEncoder = new TextEncoder();

const at = (field: string) => `/content/page.val.ts?p="${field}"` as SourcePath;

/** A ref that agrees with the metadata it is written with. */
const refFor = (
  name: string,
  metadata: { width: number; height: number; mimeType: string },
  host = HOST,
  version = VERSION,
): string => {
  const fileHash = Internal.getSHA256Hash(textEncoder.encode(name)).slice(
    0,
    12,
  );
  if (IMAGE.type !== "image") {
    throw new Error("expected an image schema");
  }
  return Internal.remote.createRemoteRef(host, {
    publicProjectId: "proj",
    coreVersion: version,
    bucket: "01",
    validationHash: Internal.remote.getValidationHash(
      version,
      IMAGE,
      "png",
      metadata,
      fileHash,
      textEncoder,
    ),
    fileHash,
    filePath: `public/val/${name}.png`,
  });
};

const META = { width: 10, height: 20, mimeType: "image/png" };
const image = (name: string, host = HOST): MediaSource => ({
  path: refFor(name, META, host),
  ...META,
});

/** A HEAD that answers from a table, and remembers what it was asked. */
const fakeHead = (answer: (url: string) => RemoteFileAnswer) => {
  const asked: string[] = [];
  const head: HeadRemoteFile = async (url) => {
    asked.push(url);
    return answer(url);
  };
  return { head, asked };
};

const check = (
  remoteFiles: Record<SourcePath, MediaSource>,
  rest: Partial<RemoteFilesCheckInput>,
) =>
  checkRemoteFiles({
    remoteFiles,
    schemaAt: () => IMAGE,
    pendingBytes: async () => "not-pending",
    isPublished: () => true,
    sampleByHost: false,
    ...rest,
  });

describe("checkRemoteFiles", () => {
  beforeEach(() => clearRemoteFileAnswers());

  test("a sound ref its host serves is not reported", async () => {
    const { head, asked } = fakeHead(() => ({ status: "found" }));
    const res = await check({ [at("hero")]: image("hero") }, { head });
    expect(res).toEqual({ errors: {}, hosts: [] });
    expect(asked).toHaveLength(1);
  });

  test("a ref whose recorded size changed is stale, fixable, and not downloaded", async () => {
    const { head, asked } = fakeHead(() => ({ status: "found" }));
    const res = await check(
      { [at("hero")]: { ...image("hero"), width: 11 } },
      { head },
    );
    expect(res.errors[at("hero")]).toEqual([
      expect.objectContaining({ fixes: ["image:check-remote"] }),
    ]);
    expect(asked).toEqual([]);
  });

  test("a ref made by an older Val is not stale for that alone", async () => {
    // Every ref carries the core version it was made with. Judging it by the
    // current version would list every remote image after each upgrade.
    const { head } = fakeHead(() => ({ status: "found" }));
    const res = await check(
      { [at("hero")]: { ...META, path: refFor("hero", META, HOST, "0.1.0") } },
      { head },
    );
    expect(res.errors).toEqual({});
  });

  test("a ref whose version was edited by hand no longer adds up", async () => {
    const edited = refFor("hero", META).replace(`/v/${VERSION}/`, "/v/0.1.0/");
    const { head } = fakeHead(() => ({ status: "found" }));
    const res = await check(
      { [at("hero")]: { ...META, path: edited } },
      { head },
    );
    expect(res.errors[at("hero")]?.[0]?.fixes).toEqual(["image:check-remote"]);
  });

  test("something that is not a ref is reported, without a fix", async () => {
    const res = await check(
      { [at("hero")]: { path: "https://example.com/hero.png" } },
      { head: fakeHead(() => ({ status: "found" })).head },
    );
    expect(res.errors[at("hero")]).toEqual([
      expect.not.objectContaining({ fixes: expect.anything() }),
    ]);
  });

  test("a file that is gone is reported on its own, and the rest are still asked", async () => {
    const gone = image("gone");
    const { head, asked } = fakeHead((url) =>
      url === gone.path
        ? { status: "missing", httpStatus: 404 }
        : { status: "found" },
    );
    const res = await check(
      { [at("a")]: gone, [at("b")]: image("b") },
      { head },
    );
    expect(Object.keys(res.errors)).toEqual([at("a")]);
    expect(res.errors[at("a")]?.[0]?.message).toContain("404");
    expect(res.hosts).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  test("a host that does not answer is one problem, found after one try", async () => {
    const { head, asked } = fakeHead((url) =>
      url.startsWith(HOST)
        ? { status: "unreachable", reason: "ECONNREFUSED" }
        : { status: "found" },
    );
    const res = await check(
      {
        [at("a")]: image("a"),
        [at("b")]: image("b"),
        [at("c")]: image("c", OTHER_HOST),
      },
      { head },
    );
    expect(res.errors).toEqual({});
    expect(res.hosts).toEqual([
      {
        host: HOST,
        status: "unreachable",
        details: expect.stringContaining("ECONNREFUSED"),
        sourcePaths: [at("a"), at("b")],
      },
    ]);
    expect(asked.filter((url) => url.startsWith(HOST))).toHaveLength(1);
  });

  test("managed: one published ref vouches for the rest on its host", async () => {
    const { head, asked } = fakeHead(() => ({ status: "found" }));
    const res = await check(
      {
        [at("a")]: image("a"),
        [at("b")]: image("b"),
        [at("c")]: image("c"),
      },
      { head, sampleByHost: true },
    );
    expect(res).toEqual({ errors: {}, hosts: [] });
    expect(asked).toHaveLength(1);
  });

  test("managed: a sample the host does not have is the host's problem", async () => {
    const { head } = fakeHead(() => ({ status: "missing", httpStatus: 404 }));
    const res = await check(
      { [at("a")]: image("a"), [at("b")]: image("b") },
      { head, sampleByHost: true },
    );
    expect(res.errors).toEqual({});
    expect(res.hosts).toEqual([
      expect.objectContaining({
        status: "missing",
        sourcePaths: [at("a"), at("b")],
      }),
    ]);
  });

  test("managed: a ref that is not published yet is asked about on its own", async () => {
    const changed = image("changed");
    const { head, asked } = fakeHead(() => ({ status: "found" }));
    await check(
      { [at("a")]: image("a"), [at("b")]: image("b"), [at("c")]: changed },
      {
        head,
        sampleByHost: true,
        isPublished: (_, ref) => ref !== changed.path,
      },
    );
    expect(asked).toHaveLength(2);
    expect(asked).toContain(changed.path);
  });

  test("a ref whose bytes are in a pending patch is not asked about, but they must be there", async () => {
    const pending = image("pending");
    const lost = image("lost");
    const { head, asked } = fakeHead(() => ({ status: "found" }));
    const res = await check(
      { [at("a")]: pending, [at("b")]: lost },
      {
        head,
        pendingBytes: async (ref) =>
          ref === pending.path ? "present" : "missing",
      },
    );
    expect(asked).toEqual([]);
    expect(Object.keys(res.errors)).toEqual([at("b")]);
    expect(res.errors[at("b")]?.[0]?.message).toContain("unpublished changes");
  });

  test("a ref a host has served is not asked about again, a failed one is", async () => {
    let answer: RemoteFileAnswer = { status: "unreachable", reason: "down" };
    const { head, asked } = fakeHead(() => answer);
    const files = { [at("a")]: image("a") };
    await check(files, { head });
    answer = { status: "found" };
    await check(files, { head });
    await check(files, { head });
    expect(asked).toHaveLength(2);
  });

  test("a found answer is kept for minutes, not for the life of the server", async () => {
    // A host that goes down after it was first asked must still be reported.
    const now = jest.spyOn(Date, "now").mockReturnValue(0);
    try {
      let answer: RemoteFileAnswer = { status: "found" };
      const { head, asked } = fakeHead(() => answer);
      const files = { [at("a")]: image("a") };
      await check(files, { head });
      answer = { status: "unreachable", reason: "down" };
      now.mockReturnValue(60_000);
      expect((await check(files, { head })).hosts).toEqual([]);
      now.mockReturnValue(10 * 60_000);
      expect((await check(files, { head })).hosts).toHaveLength(1);
      expect(asked).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });
});
