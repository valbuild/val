import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { startFakeContentService } from "./fakeContent";
import { runPublish } from "./runPublish";

/**
 * `val publish` against a content service that is really there.
 *
 * The fake speaks the protocol over HTTP and re-hashes what lands, so what is
 * under test is the whole command: which calls it makes, in which order, with
 * which credential, and what it does when an upload is lost, when the canary
 * does not render, and when the pointer does not move.
 */
const TOKEN = "val_pt_test";

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-publish-run-"));
  for (const [file, contents] of Object.entries(files)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
  return root;
}

const A_BUILD = {
  ".output/server/index.mjs": "export default () => 'hello'\n",
  ".output/public/index.html": "<!doctype html><title>hi</title>\n",
  ".output/public/assets/app-a1b2c3.js": "console.log('app')\n",
};

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
    // Polling should not really wait: what is under test is that it polls.
    sleep: () => Promise.resolve(),
    log: () => undefined,
    ...overrides,
  });
}

const publishCalls = (calls: Array<{ method: string; path: string }>) =>
  calls
    .filter(({ path: p }) => p.startsWith("/v1/publish"))
    .map(({ method, path: p }) => `${method} ${p}`);

describe("val publish", () => {
  test("uploads the build, has it verified, and promotes it", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result).toEqual({
        status: "published",
        publishId: "pub_1",
        url: "https://example.test",
        artifacts: 3,
        uploaded: 3,
        uploadedBytes: Object.values(A_BUILD).reduce(
          (sum, contents) => sum + Buffer.byteLength(contents),
          0,
        ),
      });
      // The bytes that landed are the bytes on disk - the fake re-hashed them
      // and would have asked again if they were not.
      expect(fake.stored.get("public/index.html")?.toString()).toBe(
        A_BUILD[".output/public/index.html"],
      );
      expect(publishCalls(fake.calls)).toEqual([
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/verify",
        "POST /v1/publish/pub_1/promote",
      ]);
    } finally {
      await fake.close();
    }
  });

  test("every call to content carries the project token", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeProject(A_BUILD);
    try {
      await run(root, fake.url);

      const toContent = fake.calls.filter(({ path: p }) =>
        p.startsWith("/v1/publish"),
      );
      expect(toContent).not.toHaveLength(0);
      for (const call of toContent) {
        expect(call.authorization).toBe(`Bearer ${TOKEN}`);
      }
      // The presigned PUTs carry none: the URL is the credential, and sending
      // ours to storage would hand a bucket a token that can publish.
      for (const call of fake.calls.filter(({ path: p }) =>
        p.startsWith("/storage/"),
      )) {
        expect(call.authorization).toBeNull();
      }
    } finally {
      await fake.close();
    }
  });

  test("an artifact content already has is not uploaded again", async () => {
    const known = crypto
      .createHash("sha256")
      .update(A_BUILD[".output/public/index.html"])
      .digest("hex");
    const fake = await startFakeContentService({ token: TOKEN, have: [known] });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("published");
      if (result.status === "published") {
        expect(result.artifacts).toBe(3);
        expect(result.uploaded).toBe(2);
      }
      expect(fake.stored.has("public/index.html")).toBe(false);
    } finally {
      await fake.close();
    }
  });

  test("a publish with nothing new still goes through", async () => {
    // Content has the whole build: the publish is a verify and a pointer move,
    // and it has to happen anyway - the pointer is what is out of date.
    const hashes = Object.values(A_BUILD).map((contents) =>
      crypto.createHash("sha256").update(contents).digest("hex"),
    );
    const fake = await startFakeContentService({ token: TOKEN, have: hashes });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("published");
      if (result.status === "published") {
        expect(result.uploaded).toBe(0);
      }
      expect(publishCalls(fake.calls)).toContain(
        "POST /v1/publish/pub_1/artifacts",
      );
    } finally {
      await fake.close();
    }
  });

  test("an upload that is accepted and lost is offered again", async () => {
    // The re-hash is the only thing that can notice this: storage answered
    // 200 and stored nothing, which is what a connection dropped mid-body
    // looks like from here.
    const fake = await startFakeContentService({
      token: TOKEN,
      dropUploads: 1,
    });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("published");
      expect(fake.stored.size).toBe(3);
      if (result.status === "published") {
        // Three artifacts, one of them sent twice. Counting attempts would
        // report four uploaded out of three.
        expect(result.uploaded).toBe(3);
      }
      expect(publishCalls(fake.calls)).toEqual([
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/verify",
        "POST /v1/publish/pub_1/promote",
      ]);
    } finally {
      await fake.close();
    }
  });

  test("storage saying 'slow down' is retried within the round", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      failUploadsWith5xx: 2,
    });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("published");
      expect(fake.stored.size).toBe(3);
      // One round: the retries happened inside it rather than by re-offering.
      expect(
        publishCalls(fake.calls).filter(
          (call) => call === "POST /v1/publish/pub_1/artifacts",
        ),
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
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.problems).toEqual([
          { code: "render", message: "/ threw on the server", detail: null },
        ]);
      }
      // The pointer is never asked to move.
      expect(publishCalls(fake.calls)).not.toContain(
        "POST /v1/publish/pub_1/promote",
      );
    } finally {
      await fake.close();
    }
  });

  test("verifying is waited on when it does not answer at once", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      verifyPolls: 3,
    });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("published");
      expect(
        publishCalls(fake.calls).filter(
          (call) => call === "GET /v1/publish/pub_1",
        ),
      ).toHaveLength(3);
    } finally {
      await fake.close();
    }
  });

  test("a publish that never leaves verifying gives up, and says what it was", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      // More polls than the deadline below allows.
      verifyPolls: 1000,
    });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url, {
        timings: { pollIntervalMs: 1, verifyTimeoutMs: 20 },
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.state).toBe("verifying");
        expect(result.problems.map((problem) => problem.code)).toContain(
          "timeout",
        );
      }
    } finally {
      await fake.close();
    }
  });

  test("--dry-run verifies and leaves the site alone", async () => {
    const fake = await startFakeContentService({ token: TOKEN });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url, { dryRun: true });

      expect(result.status).toBe("verified");
      expect(publishCalls(fake.calls)).toEqual([
        "POST /v1/publish",
        "POST /v1/publish/pub_1/artifacts",
        "POST /v1/publish/pub_1/verify",
      ]);
    } finally {
      await fake.close();
    }
  });

  test("a refused promote is a failed publish, not a published one", async () => {
    const fake = await startFakeContentService({
      token: TOKEN,
      promote: "fail",
    });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.problems[0].message).toBe(
          "The branch has moved on since",
        );
      }
    } finally {
      await fake.close();
    }
  });

  test("a revoked token is reported as the refusal it is", async () => {
    const fake = await startFakeContentService({ token: "val_pt_other" });
    const root = makeProject(A_BUILD);
    try {
      const result = await run(root, fake.url);

      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.message).toContain("Invalid project token");
        expect(result.message).toContain("revoked");
      }
    } finally {
      await fake.close();
    }
  });

  test("nothing to publish is said before a credential is asked for", async () => {
    const root = makeProject({ "src/index.ts": "" });

    const result = await runPublish({
      root,
      commit: "abc",
      branch: "main",
      env: {},
      log: () => undefined,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain(".output");
      expect(result.message).toContain("--dir");
    }
  });

  test("an unknown commit is refused rather than guessed", async () => {
    const root = makeProject(A_BUILD);

    const result = await runPublish({
      root,
      branch: "main",
      // No git, no CI variables, and nothing passed.
      env: {},
      log: () => undefined,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("which commit this build is of");
    }
  });

  test("a detached HEAD is not a branch", async () => {
    const root = makeProject(A_BUILD);

    const result = await runPublish({
      root,
      commit: "abc",
      env: { VAL_GIT_BRANCH: "HEAD" },
      log: () => undefined,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("which branch this build is of");
    }
  });
});
