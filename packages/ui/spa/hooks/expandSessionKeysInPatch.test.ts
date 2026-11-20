import {
  Internal,
  VAL_EXTENSION,
  initVal,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import {
  expandSessionKeysInPatch,
  isSessionKey,
  planSessionKeyExpansion,
  type SessionKey,
  type SessionKeyRemoteNamer,
  type SessionKeyTransfer,
} from "./expandSessionKeysInPatch";
import type { PatchId } from "@valbuild/core";

const { s, c } = initVal();

function serialize(valModule: ReturnType<typeof c.define>) {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) throw new Error("Schema not found");
  const source = Internal.getSource(valModule);
  return { schema: schema as SerializedSchema, source: source as Source };
}

describe("planSessionKeyExpansion", () => {
  test("smoke: image leaf — replace value with SessionKey produces one transfer and a rewritten patch", () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ hero: s.image() }), {
        hero: null as unknown as never,
      }),
    );
    const sessionKey: SessionKey = {
      key: "session-key-abc",
      filePath: "/public/val/images/hero.png",
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
      alt: "the hero",
    };
    expect(isSessionKey(sessionKey)).toBe(true);

    const inputPatch = Patch.parse([
      { op: "replace", path: ["hero"], value: sessionKey },
    ]);

    const plan = planSessionKeyExpansion({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
    });
    if (plan.kind !== "ok") {
      throw new Error(`Expected ok plan, got ${plan.kind}`);
    }
    expect(plan.transfers).toEqual([
      {
        siteId: 0,
        key: "session-key-abc",
        filePath: "/public/val/images/hero.png",
        isRemote: false,
      },
    ]);

    const applied = plan.apply({
      0: { width: 800, height: 600, mimeType: "image/png" },
    });
    if (applied.kind !== "ok") {
      throw new Error(`Expected ok apply, got ${applied.kind}`);
    }
    expect(applied.patch).toEqual([
      {
        op: "replace",
        path: ["hero"],
        value: {
          path: "/public/val/images/hero.png",
          width: 800,
          height: 600,
          mimeType: "image/png",
          alt: "the hero",
        },
      },
      {
        op: "file",
        path: ["hero"],
        filePath: "/public/val/images/hero.png",
        value: "session-key-abc",
        remote: false,
        metadata: {
          width: 800,
          height: 600,
          mimeType: "image/png",
          alt: "the hero",
        },
      },
    ]);
  });

  test("smoke: richtext inline img — add op with {tag:'img', src:SessionKey} produces one transfer + nestedFilePath", () => {
    const { schema, source } = serialize(
      c.define(
        "/content/article.val.ts",
        s.object({
          body: s.richtext({
            img: true,
          }),
        }),
        { body: [] },
      ),
    );
    const sessionKey: SessionKey = {
      key: "session-key-rt",
      filePath: "/public/val/images/inline.png",
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
    };
    const inputPatch = Patch.parse([
      {
        op: "add",
        path: ["body", "0", "children", "1"],
        value: { tag: "img", src: sessionKey },
      },
    ]);

    const plan = planSessionKeyExpansion({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
    });
    if (plan.kind !== "ok") {
      throw new Error(`Expected ok plan, got ${plan.kind}`);
    }
    expect(plan.transfers).toEqual([
      {
        siteId: 0,
        key: "session-key-rt",
        filePath: "/public/val/images/inline.png",
        isRemote: false,
      },
    ]);

    const applied = plan.apply({
      0: { width: 400, height: 300, mimeType: "image/png" },
    });
    if (applied.kind !== "ok") {
      throw new Error(`Expected ok apply, got ${applied.kind}`);
    }
    expect(applied.patch).toEqual([
      {
        op: "add",
        path: ["body", "0", "children", "1"],
        value: {
          tag: "img",
          src: {
            path: "/public/val/images/inline.png",
            width: 400,
            height: 300,
            mimeType: "image/png",
          },
        },
      },
      {
        op: "file",
        path: ["body", "0", "children", "1"],
        nestedFilePath: ["src"],
        filePath: "/public/val/images/inline.png",
        value: "session-key-rt",
        remote: false,
        metadata: { width: 400, height: 300, mimeType: "image/png" },
      },
    ]);
  });
});

describe("expandSessionKeysInPatch", () => {
  test("batches multiple SessionKeys into a single transfer call", async () => {
    const { schema, source } = serialize(
      c.define(
        "/content/page.val.ts",
        s.object({ hero: s.image(), banner: s.image() }),
        {
          hero: null as unknown as never,
          banner: null as unknown as never,
        },
      ),
    );
    const heroKey: SessionKey = {
      key: "session-key-hero",
      filePath: "/public/val/images/hero.png",
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
    };
    const bannerKey: SessionKey = {
      key: "session-key-banner",
      filePath: "/public/val/images/banner.png",
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
    };
    const inputPatch = Patch.parse([
      { op: "replace", path: ["hero"], value: heroKey },
      { op: "replace", path: ["banner"], value: bannerKey },
    ]);

    const transferCalls: Parameters<SessionKeyTransfer>[0][] = [];
    const transfer: SessionKeyTransfer = async (transferArgs) => {
      transferCalls.push(transferArgs);
      return {
        patchId: transferArgs.patchId,
        files: transferArgs.files.map((f) => ({
          filePath: f.filePath,
          metadata: { width: 100, height: 50, mimeType: "image/png" },
        })),
      };
    };

    const result = await expandSessionKeysInPatch({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-1" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer,
    });

    expect(transferCalls).toHaveLength(1);
    expect(transferCalls[0].patchId).toBe("patch-1");
    expect(transferCalls[0].files).toEqual([
      {
        filePath: "/public/val/images/hero.png",
        key: "session-key-hero",
        isRemote: false,
      },
      {
        filePath: "/public/val/images/banner.png",
        key: "session-key-banner",
        isRemote: false,
      },
    ]);
    if (result.kind !== "ok") {
      throw new Error(`Expected ok result, got ${result.kind}`);
    }
  });

  test("dedupes identical (filePath, key, isRemote) transfers but fans metadata to all sites", async () => {
    const { schema, source } = serialize(
      c.define(
        "/content/page.val.ts",
        s.object({ hero: s.image(), banner: s.image() }),
        {
          hero: null as unknown as never,
          banner: null as unknown as never,
        },
      ),
    );
    const sharedKey: SessionKey = {
      key: "shared-key",
      filePath: "/public/val/images/shared.png",
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
    };
    const inputPatch = Patch.parse([
      { op: "replace", path: ["hero"], value: sharedKey },
      { op: "replace", path: ["banner"], value: sharedKey },
    ]);

    const transferCalls: Parameters<SessionKeyTransfer>[0][] = [];
    const transfer: SessionKeyTransfer = async (transferArgs) => {
      transferCalls.push(transferArgs);
      return {
        patchId: transferArgs.patchId,
        files: transferArgs.files.map((f) => ({
          filePath: f.filePath,
          metadata: { width: 200, height: 100, mimeType: "image/png" },
        })),
      };
    };

    const result = await expandSessionKeysInPatch({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-2" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer,
    });

    expect(transferCalls).toHaveLength(1);
    expect(transferCalls[0].files).toEqual([
      {
        filePath: "/public/val/images/shared.png",
        key: "shared-key",
        isRemote: false,
      },
    ]);
    if (result.kind !== "ok") {
      throw new Error(`Expected ok result, got ${result.kind}`);
    }
  });

  test("skips the transfer call entirely when the patch contains no SessionKeys", async () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ title: s.string() }), {
        title: "hello",
      }),
    );
    const inputPatch = Patch.parse([
      { op: "replace", path: ["title"], value: "world" },
    ]);

    let callCount = 0;
    const transfer: SessionKeyTransfer = async () => {
      callCount += 1;
      return { patchId: "unused" as PatchId, files: [] };
    };

    const result = await expandSessionKeysInPatch({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-3" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer,
    });

    expect(callCount).toBe(0);
    if (result.kind !== "ok") {
      throw new Error(`Expected ok result, got ${result.kind}`);
    }
    expect(result.patch).toEqual(inputPatch);
  });
});

describe("expandSessionKeysInPatch, into remote storage", () => {
  const metadata = { width: 8, height: 8, mimeType: "image/png" };
  const SHA = "a".repeat(64);
  /** A content service that hands back the hash -- or, `withSha` false, one that predates it. */
  function recordingTransfer(withSha = true) {
    const calls: Parameters<SessionKeyTransfer>[0][] = [];
    const transfer: SessionKeyTransfer = async (transferArgs) => {
      calls.push(transferArgs);
      return {
        patchId: transferArgs.patchId,
        files: transferArgs.files.map((f) => ({
          filePath: f.filePath,
          metadata,
          ...(withSha ? { sha256: SHA } : {}),
        })),
      };
    };
    return { calls, transfer };
  }
  function sessionKey(name: string): SessionKey {
    return {
      key: `session-key-${name}`,
      filePath: `/public/val/images/${name}.png`,
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
    };
  }
  /** Names a remote file as a fake ref, recording what it was asked. */
  function recordingNamer() {
    const calls: Parameters<SessionKeyRemoteNamer>[0][] = [];
    const nameRemote: SessionKeyRemoteNamer = async (args) => {
      calls.push(args);
      return {
        status: "ok",
        ref: `https://remote.val.build/file/p/x${args.localPath}`,
      };
    };
    return { calls, nameRemote };
  }

  test("a remote image field is moved as remote and stored under its ref, named from the service's hash", async () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ hero: s.image().remote() }), {
        hero: null as unknown as never,
      }),
    );
    const { calls: transfers, transfer } = recordingTransfer();
    const { calls: names, nameRemote } = recordingNamer();
    const result = await expandSessionKeysInPatch({
      patch: Patch.parse([
        { op: "replace", path: ["hero"], value: sessionKey("hero") },
      ]),
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-r" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer,
      nameRemote,
    });

    // Attached as remote, under its `/public` path: the bytes move, as is.
    expect(transfers[0].files).toEqual([
      {
        filePath: "/public/val/images/hero.png",
        key: "session-key-hero",
        isRemote: true,
      },
    ]);
    // ...and named from the hash the service returned, against the field's
    // own schema.
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({
      localPath: "/public/val/images/hero.png",
      patchId: "patch-r",
      remoteSchema: { type: "image", remote: true },
      metadata,
      sha256: SHA,
    });
    if (result.kind !== "ok") {
      throw new Error(`Expected ok result, got ${result.kind}`);
    }
    const ref = "https://remote.val.build/file/p/x/public/val/images/hero.png";
    expect(result.patch).toEqual([
      {
        op: "replace",
        path: ["hero"],
        value: { path: ref, ...metadata },
      },
      {
        op: "file",
        path: ["hero"],
        filePath: ref,
        // The session key: the bytes are already on the patch.
        value: "session-key-hero",
        remote: true,
        metadata,
      },
    ]);
  });

  test("against a service that sends no hash, the namer is asked without one", async () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ hero: s.image().remote() }), {
        hero: null as unknown as never,
      }),
    );
    const { calls: names, nameRemote } = recordingNamer();
    const result = await expandSessionKeysInPatch({
      patch: Patch.parse([
        { op: "replace", path: ["hero"], value: sessionKey("hero") },
      ]),
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-o" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer: recordingTransfer(false).transfer,
      nameRemote,
    });
    expect(result.kind).toBe("ok");
    expect(names[0].sha256).toBeUndefined();
  });

  test("a remote inline image in rich text is named against the rich text's img schema", async () => {
    const { schema, source } = serialize(
      c.define(
        "/content/article.val.ts",
        s.object({ body: s.richtext({ img: s.image().remote() }) }),
        { body: [] },
      ),
    );
    const { calls: names, nameRemote } = recordingNamer();
    const result = await expandSessionKeysInPatch({
      patch: Patch.parse([
        {
          op: "add",
          path: ["body", "0", "children", "1"],
          value: { tag: "img", src: sessionKey("inline") },
        },
      ]),
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-rt" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer: recordingTransfer().transfer,
      nameRemote,
    });
    expect(names[0].remoteSchema).toMatchObject({
      type: "image",
      remote: true,
    });
    if (result.kind !== "ok") {
      throw new Error(`Expected ok result, got ${result.kind}`);
    }
    const ref =
      "https://remote.val.build/file/p/x/public/val/images/inline.png";
    expect(result.patch[0]).toMatchObject({
      value: { tag: "img", src: { path: ref } },
    });
    expect(result.patch[1]).toMatchObject({
      op: "file",
      nestedFilePath: ["src"],
      filePath: ref,
      value: "session-key-inline",
      remote: true,
    });
  });

  test("beside a remote image, a local one is left as it is", async () => {
    const { schema, source } = serialize(
      c.define(
        "/content/page.val.ts",
        s.object({ hero: s.image().remote(), logo: s.image() }),
        { hero: null as unknown as never, logo: null as unknown as never },
      ),
    );
    const { calls: transfers, transfer } = recordingTransfer();
    const { calls: names, nameRemote } = recordingNamer();
    const result = await expandSessionKeysInPatch({
      patch: Patch.parse([
        { op: "replace", path: ["hero"], value: sessionKey("hero") },
        { op: "replace", path: ["logo"], value: sessionKey("logo") },
      ]),
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-m" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer,
      nameRemote,
    });
    expect(transfers[0].files.map((f) => f.isRemote)).toEqual([true, false]);
    expect(names.map((n) => n.localPath)).toEqual([
      "/public/val/images/hero.png",
    ]);
    if (result.kind !== "ok") {
      throw new Error(`Expected ok result, got ${result.kind}`);
    }
    expect(result.patch[3]).toEqual({
      op: "file",
      path: ["logo"],
      filePath: "/public/val/images/logo.png",
      value: "session-key-logo",
      remote: false,
      metadata,
    });
  });

  test("a remote image with nothing to name it is refused, not stored under a repo path", async () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ hero: s.image().remote() }), {
        hero: null as unknown as never,
      }),
    );
    const result = await expandSessionKeysInPatch({
      patch: Patch.parse([
        { op: "replace", path: ["hero"], value: sessionKey("hero") },
      ]),
      moduleSchema: schema,
      moduleSource: source,
      patchId: "patch-n" as PatchId,
      parentRef: { type: "head", headBaseSha: "test-sha" },
      transfer: recordingTransfer().transfer,
    });
    expect(result.kind).toBe("error");
  });
});

describe("planSessionKeyExpansion, a whole rich text written at once", () => {
  test("finds the inline image in a value replacing the rich text itself", () => {
    // A rich text that is empty has no paragraph to add an image into, so
    // the natural write is the whole value -- at the rich text's own path.
    const { schema, source } = serialize(
      c.define(
        "/content/article.val.ts",
        s.object({ body: s.richtext({ img: true }) }),
        { body: [] },
      ),
    );
    const sessionKey: SessionKey = {
      key: "session-key-rt",
      filePath: "/public/val/images/inline.png",
      [VAL_EXTENSION]: "ai_session_file",
      _tag: "image",
    };
    const plan = planSessionKeyExpansion({
      patch: Patch.parse([
        {
          op: "replace",
          path: ["body"],
          value: [{ tag: "p", children: [{ tag: "img", src: sessionKey }] }],
        },
      ]),
      moduleSchema: schema,
      moduleSource: source,
    });
    if (plan.kind !== "ok") {
      throw new Error(
        `Expected ok plan, got ${plan.kind}: ${JSON.stringify(plan)}`,
      );
    }
    expect(plan.transfers).toEqual([
      {
        siteId: 0,
        key: "session-key-rt",
        filePath: "/public/val/images/inline.png",
        isRemote: false,
      },
    ]);
    const applied = plan.apply({
      0: { width: 4, height: 3, mimeType: "image/png" },
    });
    if (applied.kind !== "ok") {
      throw new Error(`Expected ok apply, got ${applied.kind}`);
    }
    expect(applied.patch[1]).toMatchObject({
      op: "file",
      path: ["body"],
      nestedFilePath: ["0", "children", "0", "src"],
    });
  });
});
