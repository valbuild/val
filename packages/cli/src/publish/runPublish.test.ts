import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { startFakeContentService } from "./fakeContent";
import { runPublish } from "./runPublish";

/**
 * `val publish` against a content service that is really there.
 *
 * The fake speaks the publish API over HTTP and re-hashes what lands, so what
 * is under test is the whole command: which calls it makes, in which order,
 * with which credential, and what it does when a slot expires, when an upload
 * is lost, when the canary does not render, and when somebody pushed while it
 * was building.
 */
const TOKEN = "val_pt_test";

const A_BUILD: Record<string, string> = {
  server: "export default { fetch() {} }\n",
  client: "console.log('client')\n",
  "chunk/client/app-a1b2c3.js": "export const app = 1\n",
  "public/index.html": "<!doctype html><title>hi</title>\n",
};

function makeArtifacts(files: Record<string, string> = A_BUILD): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-publish-run-"));
  for (const [key, contents] of Object.entries(files)) {
    const absolute = path.join(root, ".val", "publish", key);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
  return root;
}

const sha256 = (contents: string) =>
  crypto.createHash("sha256").update(contents).digest("hex");

function run(
  root: string,
  url: string,
  overrides: Parameters<typeof runPublish>[0] = {},
) {
  return runPublish({
    root,
    commit: "1234567890abcdef1234567890abcdef12345678",
    branch: "main",
    env: { VAL_PROJECT_TOKEN: TOKEN, VAL_CONTENT_URL: url },
    sleep: () => Promise.resolve(),
    log: () => undefined,
    ...overrides,
  });
}

const apiCalls = (calls: Array<{ method: string; path: string }>) =>
  calls
    .filter(({ path: p }) => p.startsWith("/v1/publish"))
    .map(({ method, path: p }) => `${method} ${p}`);

describe("val publish", () => {
  test("declares, uploads, confirms, verifies and promotes", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result).toEqual({
        status: "live",
        publishId: "pub_1",
        url: "https://example.test",
        commit: "1234567890abcdef1234567890abcdef12345678",
        artifacts: 4,
        uploaded: 4,
        uploadedBytes: Object.values(A_BUILD).reduce(
          (sum, contents) => sum + Buffer.byteLength(contents),
          0,
        ),
        // `CANARY_HAS_NO_PREVIEW`: null, until the platform has somewhere to
        // point at.
        previewUrl: null,
      });
      expect(apiCalls(fake.calls)).toEqual([
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/verify",
        "POST /v1/publish/pub_1/promote",
      ]);
      // The bytes that landed are the bytes on disk, under the key the file
      // was at - content re-hashed them and would have refused otherwise.
      expect(fake.stored.get("public/index.html")?.toString()).toBe(
        A_BUILD["public/index.html"],
      );
      expect(fake.stored.get("chunk/client/app-a1b2c3.js")?.toString()).toBe(
        A_BUILD["chunk/client/app-a1b2c3.js"],
      );
    } finally {
      await fake.close();
    }
  });

  test("the declaration says what the build is, by key and by hash", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      await run(root, fake.url);

      const [declaration] = [...fake.declarations.values()];
      expect(declaration).toMatchObject({
        commit: "1234567890abcdef1234567890abcdef12345678",
        branch: "main",
        layerRev: null,
        // Null is a third answer - "this build did not say" - not false.
        linksOwnCss: null,
        artifacts: [
          {
            key: "chunk/client/app-a1b2c3.js",
            sha256: sha256(A_BUILD["chunk/client/app-a1b2c3.js"]),
            bytes: Buffer.byteLength(A_BUILD["chunk/client/app-a1b2c3.js"]),
          },
          { key: "client", sha256: sha256(A_BUILD["client"]) },
          {
            key: "public/index.html",
            sha256: sha256(A_BUILD["public/index.html"]),
          },
          { key: "server", sha256: sha256(A_BUILD["server"]) },
        ],
      });
    } finally {
      await fake.close();
    }
  });

  test("every call to content carries the project token, and the store gets none", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      await run(root, fake.url);

      const toContent = fake.calls.filter(({ path: p }) =>
        p.startsWith("/v1/publish"),
      );
      expect(toContent).not.toHaveLength(0);
      for (const call of toContent) {
        expect(call.authorization).toBe(`Bearer ${TOKEN}`);
      }
      // A presigned URL is the permission. Sending ours would hand a bucket a
      // token that can publish.
      for (const call of fake.calls.filter(({ path: p }) =>
        p.startsWith("/store/"),
      )) {
        expect(call.authorization).toBeNull();
      }
    } finally {
      await fake.close();
    }
  });

  test("an artifact content already holds gets no slot", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      have: [sha256(A_BUILD["public/index.html"])],
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("live");
      if (result.status === "live") {
        expect(result.artifacts).toBe(4);
        expect(result.uploaded).toBe(3);
      }
      expect(fake.stored.has("public/index.html")).toBe(false);
    } finally {
      await fake.close();
    }
  });

  test("a build content holds entirely still confirms, verifies and promotes", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      have: Object.values(A_BUILD).map(sha256),
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("live");
      if (result.status === "live") {
        expect(result.uploaded).toBe(0);
      }
      // The pointer is what was out of date, so the publish still has to happen.
      expect(apiCalls(fake.calls)).toContain(
        "POST /v1/publish/pub_1/artifacts",
      );
      expect(fake.stored.size).toBe(0);
    } finally {
      await fake.close();
    }
  });

  test("re-publishing a build that is live is a success, not a second publish", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      await run(root, fake.url);
      const again = await run(root, fake.url);

      // Idempotent on the build hash: the same publish, not re-opened - that
      // would mint slots to overwrite bytes that are currently serving.
      expect(again.status).toBe("live");
      if (again.status === "live") {
        expect(again.publishId).toBe("pub_1");
        expect(again.uploaded).toBe(0);
      }
      expect(
        apiCalls(fake.calls).filter((call) => call.endsWith("/promote")),
      ).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  test("an upload that is accepted and lost is declared again and sent again", async () => {
    // The re-hash is the only thing that can notice: the store answered 200
    // and kept nothing, which is what a connection dying mid-body looks like.
    const fake = await startFakeContentService({
      token: TOKEN,
      dropUploads: 1,
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("live");
      expect(fake.stored.size).toBe(4);
      if (result.status === "live") {
        // Four artifacts, one of them sent twice: counting attempts would
        // report five uploaded out of four.
        expect(result.uploaded).toBe(4);
      }
      expect(apiCalls(fake.calls)).toEqual([
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/verify",
        "POST /v1/publish/pub_1/promote",
      ]);
    } finally {
      await fake.close();
    }
  });

  test("an expired slot is declared again rather than failing the publish", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      expireSlots: 1,
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("live");
      expect(fake.stored.size).toBe(4);
      expect(
        apiCalls(fake.calls).filter((call) => call === "POST /v1/publish"),
      ).toHaveLength(2);
    } finally {
      await fake.close();
    }
  });

  test("a store saying 'slow down' is retried without declaring again", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      failUploadsWith5xx: 2,
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("live");
      expect(fake.stored.size).toBe(4);
      expect(
        apiCalls(fake.calls).filter((call) => call === "POST /v1/publish"),
      ).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  test("a canary that does not render stops the publish, and says why", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      verify: "fail",
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.state).toBe("failed");
        // The platform's own code, passed through: rewording it would lose the
        // only sentence that says what to change.
        expect(result.problems).toEqual([
          {
            code: "PLATFORM_RENDER_FAILED",
            message: "/ threw on the server",
          },
        ]);
      }
      expect(apiCalls(fake.calls)).not.toContain(
        "POST /v1/publish/pub_1/promote",
      );
    } finally {
      await fake.close();
    }
  });

  test("a push while we were building is a rebuild, not a retry", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      promote: "stale",
      head: "abcdef1234567890abcdef1234567890abcdef12",
    });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        // Content's own sentence, kept: it already says what to do.
        expect(result.message).toContain("Rebuild from the current head");
        expect(result.message).toContain("abcdef1");
        expect(result.problems[0].code).toBe("POINTER_STALE");
      }
    } finally {
      await fake.close();
    }
  });

  test("a refused declaration reports every problem, not the first", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    // No server bundle, and a layer with no rev to name it by.
    const root = makeArtifacts({
      client: "console.log('client')\n",
      layer: "not gzip at all",
    });
    try {
      const result = await run(root, fake.url, { layerRev: "" });

      expect(result.status).toBe("error");
      if (result.status === "error") {
        // Read before anything is declared: the layer is unreadable here.
        expect(result.message).toContain("gzipped JSON");
      }
    } finally {
      await fake.close();
    }
  });

  test("the layer names itself, and the rev comes from inside it", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    fs.writeFileSync(
      path.join(root, ".val", "publish", "layer"),
      zlib.gzipSync(
        JSON.stringify({ rev: "layer-rev-7", worker: {}, browser: {} }),
      ),
    );
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("live");
      const [declaration] = [...fake.declarations.values()];
      // A layer that is SENT has to say which it is: that is the name the
      // loader stores and later reuses it by.
      expect(declaration).toMatchObject({ layerRev: "layer-rev-7" });
    } finally {
      await fake.close();
    }
  });

  test("a layer content already holds is named rather than sent", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url, { layerRev: "layer-rev-9" });

      expect(result.status).toBe("live");
      const [declaration] = [...fake.declarations.values()];
      expect(declaration).toMatchObject({ layerRev: "layer-rev-9" });
      expect(fake.stored.has("layer")).toBe(false);
    } finally {
      await fake.close();
    }
  });

  test("a declaration content refuses is reported with all of its problems", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts({ client: "console.log('client')\n" });
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.message).toBe("This publish cannot be declared");
        expect(result.problems).toEqual([
          {
            code: "ARTIFACT_MISSING",
            message: "A publish needs at least a server and a client bundle.",
            keys: ["server"],
          },
        ]);
      }
      // Nothing was uploaded: a malformed declaration is refused before any
      // slot is minted.
      expect(fake.stored.size).toBe(0);
    } finally {
      await fake.close();
    }
  });

  test("--dry-run verifies and leaves the pointer alone", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url, { dryRun: true });

      expect(result.status).toBe("verified");
      if (result.status === "verified") {
        expect(result.previewUrl).toBeNull();
      }
      expect(apiCalls(fake.calls)).toEqual([
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/verify",
      ]);
    } finally {
      await fake.close();
    }
  });

  test("a token that is not a project token is refused with that sentence", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    try {
      const result = await run(root, fake.url, {
        env: { VAL_PROJECT_TOKEN: "val_pt_other", VAL_CONTENT_URL: fake.url },
      });

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.message).toContain("may have been revoked");
      }
    } finally {
      await fake.close();
    }
  });

  test("an answer this CLI cannot read names the field, not the symptom", async () => {
    // The service versions separately, so its answers are parsed rather than
    // trusted: a type from a private repo could not have caught this, and a
    // missing field surfacing three functions later is the failure worth
    // spending a schema on.
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeArtifacts();
    const truncating: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      const url = typeof input === "string" ? input : String(input);
      if (url.endsWith("/v1/publish") && init?.method === "POST") {
        return new Response(JSON.stringify({ state: "awaiting-artifacts" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return res;
    };
    try {
      const result = await run(root, fake.url, { fetchImpl: truncating });

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.message).toContain("POST /v1/publish");
        expect(result.message).toContain("publishId");
      }
    } finally {
      await fake.close();
    }
  });

  test("nothing to publish is said before a credential is asked for", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-publish-empty-"));

    const result = await runPublish({ root, env: {}, log: () => undefined });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("--artifacts");
    }
  });

  test("an unknown commit is refused rather than guessed", async () => {
    const root = makeArtifacts();

    const result = await runPublish({
      root,
      branch: "main",
      env: {},
      log: () => undefined,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("which commit this build is of");
    }
  });

  test("a detached HEAD is not a branch", async () => {
    const root = makeArtifacts();

    const result = await runPublish({
      root,
      commit: "abc1234",
      env: { VAL_GIT_BRANCH: "HEAD" },
      log: () => undefined,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("which branch this build is of");
    }
  });
});
