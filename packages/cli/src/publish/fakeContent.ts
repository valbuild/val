import crypto from "crypto";
import http from "http";
import { PublishProblem } from "./contentApi";

/**
 * A local stand-in for the publish API on content.val.build.
 *
 * It implements the protocol over real HTTP - the token exchange, the five
 * publish calls, and an object store the presigned PUTs point at - so
 * `val publish` runs against it exactly as it runs against the service: one
 * `VAL_CONTENT_URL`, and nothing stubbed inside the CLI.
 *
 * Three things it does for real, because they are the three the CLI can get
 * wrong on its own:
 *
 * - **It re-hashes what landed.** Bytes that do not match the declared sha256
 *   are answered with `409 ARTIFACT_MISMATCH`, which is how a truncated upload
 *   is caught here rather than by a reader of the live site.
 * - **It holds artifacts per project by hash.** Declaring the same build twice
 *   mints no slots the second time - the dedupe the whole declare step exists
 *   for.
 * - **It is idempotent on `buildHash`.** A re-declared build is the same
 *   publish, so a retried CI job resumes rather than starting again.
 *
 * Run it by hand to publish against nothing:
 *
 *     const fake = await startFakeContentService({});
 *     VAL_CONTENT_URL=<fake.url> VAL_PROJECT_TOKEN=val_pt_x npx val publish
 */
export type FakeContentOptions = {
  /** The project token it accepts. Any token is accepted when absent. */
  token?: string;
  /** sha256s it already holds for this project, so no slot is minted. */
  have?: string[];
  /** Swallow the first N uploads: accept the PUT, store nothing. */
  dropUploads?: number;
  /** Answer the first N uploads with a 503 before accepting any. */
  failUploadsWith5xx?: number;
  /** Answer the first N uploads with a 403, as an expired slot does. */
  expireSlots?: number;
  /** What the canary does. */
  verify?: "ok" | "fail";
  /** Refuse the promote because the branch moved on. */
  promote?: "ok" | "stale";
  /**
   * The head the branch is at now.
   *
   * Only sent when a test asks for it: the API's written contract has it on a
   * stale promote and the handler does not send it, which is a difference
   * worth being able to drive from both sides.
   */
  head?: string;
};

export type FakeContentService = {
  url: string;
  calls: Array<{ method: string; path: string; authorization: string | null }>;
  /** What is in the object store now, by artifact key. */
  stored: Map<string, Buffer>;
  /** What each publish was declared with, by publish id. */
  declarations: Map<string, unknown>;
  close: () => Promise<void>;
};

type Artifact = { key: string; sha256: string; bytes: number };

type Publish = {
  id: string;
  buildHash: string;
  commit: string | null;
  branch: string | null;
  artifacts: Artifact[];
  state: string;
  problems: PublishProblem[];
};

export async function startFakeContentService(
  options: FakeContentOptions,
): Promise<FakeContentService> {
  const held = new Set(options.have ?? []);
  const calls: FakeContentService["calls"] = [];
  const stored = new Map<string, Buffer>();
  const declarations = new Map<string, unknown>();
  const publishes = new Map<string, Publish>();
  const byBuildHash = new Map<string, string>();
  let dropsLeft = options.dropUploads ?? 0;
  let failuresLeft = options.failUploadsWith5xx ?? 0;
  let expiriesLeft = options.expireSlots ?? 0;
  let nextId = 1;

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      send(res, 500, { statusCode: 500, message: String(err) });
    });
  });

  const outstanding = (publish: Publish): Artifact[] =>
    publish.artifacts.filter((artifact) => !held.has(artifact.sha256));

  const slotsFor = (publish: Publish) =>
    outstanding(publish).map((artifact) => ({
      key: artifact.key,
      url: `${baseUrl()}/store/${encodeURIComponent(publish.id)}/${encodeURIComponent(artifact.key)}`,
      method: "PUT",
      // What `mintUploadSlots` sends. The size is signed into the URL rather
      // than declared in a header.
      headers: { "content-type": "application/octet-stream" },
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }));

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", baseUrl());
    const parts = url.pathname.split("/").filter((part) => part !== "");
    const authorization = req.headers.authorization ?? null;
    calls.push({ method: req.method ?? "", path: url.pathname, authorization });

    // The object store. A presigned URL is the one thing here that is not
    // content, and it carries no credential of ours.
    if (parts[0] === "store") {
      const body = await readBody(req);
      if (expiriesLeft > 0) {
        expiriesLeft--;
        send(res, 403, { statusCode: 403, message: "Request has expired" });
        return;
      }
      if (failuresLeft > 0) {
        failuresLeft--;
        send(res, 503, { statusCode: 503, message: "Slow down" });
        return;
      }
      if (dropsLeft > 0) {
        dropsLeft--;
        // Accepted, and thrown away: a connection that died mid-body looks
        // exactly like this from the publisher's side.
        send(res, 200, {});
        return;
      }
      stored.set(decodeURIComponent(parts[2] ?? ""), body);
      send(res, 200, {});
      return;
    }

    if (parts[0] !== "v1") {
      send(res, 404, { statusCode: 404, message: "No such route" });
      return;
    }

    // POST /v1/<org>/<project>/publish-token
    if (parts.length === 4 && parts[3] === "publish-token") {
      if (typeof req.headers["x-val-pat"] !== "string") {
        send(res, 401, {
          statusCode: 401,
          message: "No personal access token",
        });
        return;
      }
      send(res, 200, {
        token: options.token ?? "val_pt_fake",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        publicProjectId: "fake-project",
        productionUrl: "https://example.test",
      });
      return;
    }

    if (parts[1] !== "publish") {
      send(res, 404, { statusCode: 404, message: "No such route" });
      return;
    }
    if (!authorization?.startsWith("Bearer val_pt_")) {
      send(res, 401, {
        statusCode: 401,
        message: "This needs a project token as `Authorization: Bearer`.",
      });
      return;
    }
    if (
      options.token !== undefined &&
      authorization !== `Bearer ${options.token}`
    ) {
      send(res, 401, {
        statusCode: 401,
        message: "This project token is not valid. It may have been revoked.",
      });
      return;
    }

    // POST /v1/publish - declare.
    if (parts.length === 2 && req.method === "POST") {
      const body = parseJson(await readBody(req));
      const problems = declarationProblems(body);
      if (problems.length > 0) {
        send(res, 400, {
          statusCode: 400,
          message: "This publish cannot be declared",
          details: problems,
        });
        return;
      }
      const buildHash = stringOf(body, "buildHash");
      declarations.set(buildHash, body);
      const existingId = byBuildHash.get(buildHash);
      const publish: Publish = publishes.get(existingId ?? "") ?? {
        id: `pub_${nextId++}`,
        buildHash,
        commit: nullableStringOf(body, "commit"),
        branch: nullableStringOf(body, "branch"),
        artifacts: artifactsOf(body),
        state: "awaiting-artifacts",
        problems: [],
      };
      publishes.set(publish.id, publish);
      byBuildHash.set(buildHash, publish.id);
      // A live publish is not re-opened: re-declaring would mint slots to
      // overwrite the bytes of a build that is currently serving.
      const uploads = publish.state === "live" ? [] : slotsFor(publish);
      send(res, 200, {
        publishId: publish.id,
        state: publish.state,
        project: {
          publicProjectId: "fake-project",
          siteUrl: "https://example.test",
        },
        uploads,
        have: publish.artifacts
          .filter((artifact) => held.has(artifact.sha256))
          .map((artifact) => artifact.key),
      });
      return;
    }

    const publish = publishes.get(decodeURIComponent(parts[2] ?? ""));
    if (!publish) {
      send(res, 404, { statusCode: 404, message: "No such publish" });
      return;
    }

    // GET /v1/publish/{id} - status.
    if (parts.length === 3 && req.method === "GET") {
      send(res, 200, {
        publishId: publish.id,
        state: publish.state,
        buildHash: publish.buildHash,
        missing: outstanding(publish).map((artifact) => artifact.key),
        problems: publish.problems,
      });
      return;
    }

    if (req.method !== "POST") {
      send(res, 405, { statusCode: 405, message: "Method not allowed" });
      return;
    }
    await readBody(req);

    // POST /v1/publish/{id}/artifacts - confirm. What landed is re-hashed.
    if (parts[3] === "artifacts") {
      const problems: Publish["problems"] = [];
      for (const artifact of outstanding(publish)) {
        const bytes = stored.get(artifact.key);
        if (!bytes) {
          problems.push({
            code: "ARTIFACT_NOT_UPLOADED",
            message:
              "These artifacts were declared but nothing was uploaded for them.",
            hint: "Upload slots expire. Declare the publish again for fresh ones.",
            keys: [artifact.key],
          });
          continue;
        }
        if (
          sha256(bytes) !== artifact.sha256 ||
          bytes.length !== artifact.bytes
        ) {
          problems.push({
            code: "ARTIFACT_MISMATCH",
            message: "What was uploaded is not what was declared.",
            hint: "The bytes at that key do not match the sha256 or the size given for it.",
            keys: [artifact.key],
          });
          continue;
        }
        held.add(artifact.sha256);
      }
      if (problems.length > 0) {
        send(res, 409, {
          statusCode: 409,
          message: "Some artifacts did not arrive as declared",
          details: problems,
        });
        return;
      }
      publish.state = "ready";
      send(res, 200, { state: publish.state, problems: [] });
      return;
    }

    // POST /v1/publish/{id}/verify - a canary build and render.
    if (parts[3] === "verify") {
      const ok = options.verify !== "fail";
      publish.state = ok ? "verified" : "failed";
      publish.problems = ok
        ? []
        : [
            {
              code: "PLATFORM_RENDER_FAILED",
              message: "/ threw on the server",
            },
          ];
      send(res, 200, {
        state: publish.state,
        ok,
        // Null either way today: `CANARY_HAS_NO_PREVIEW`. A test that wants a
        // URL here is testing a service that does not exist yet.
        previewUrl: null,
        problems: publish.problems,
      });
      return;
    }

    // POST /v1/publish/{id}/promote - the pointer moves, or it does not.
    if (parts[3] === "promote") {
      if (options.promote === "stale") {
        // The shape `postPublishPromote.ts` sends: the ordinary error envelope,
        // with the code in `details`. `head` is in the API's written contract
        // and is not sent today, so it is only here when a test asks for it.
        send(res, 409, {
          statusCode: 409,
          message:
            "This build's commit is no longer the head of its branch, so it " +
            "was not promoted. Rebuild from the current head.",
          details: [
            {
              code: "POINTER_STALE",
              message: "not-fast-forward",
            },
          ],
          ...(options.head ? { head: options.head } : {}),
        });
        return;
      }
      publish.state = "live";
      send(res, 200, {
        state: publish.state,
        url: "https://example.test",
        commit: publish.commit,
      });
      return;
    }

    send(res, 404, { statusCode: 404, message: "No such route" });
  };

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake content service did not get a port");
  }
  const port = address.port;
  function baseUrl(): string {
    return `http://127.0.0.1:${port}`;
  }

  return {
    url: baseUrl(),
    calls,
    stored,
    declarations,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/**
 * The half of `publishPlan.ts` a publisher can actually trip over.
 *
 * Not all of it - the point here is that a declaration is answered with EVERY
 * problem at once, and that the required keys and the layer rule are enforced
 * somewhere the CLI has to cope with.
 */
function declarationProblems(
  body: unknown,
): Array<{ code: string; message: string; keys?: string[] }> {
  const problems: Array<{ code: string; message: string; keys?: string[] }> =
    [];
  const artifacts = artifactsOf(body);
  const keys = new Set(artifacts.map((artifact) => artifact.key));
  const missing = ["server", "client"].filter((key) => !keys.has(key));
  if (missing.length > 0) {
    problems.push({
      code: "ARTIFACT_MISSING",
      message: "A publish needs at least a server and a client bundle.",
      keys: missing,
    });
  }
  if (keys.has("layer") && !nullableStringOf(body, "layerRev")) {
    problems.push({
      code: "LAYER_REV_MISSING",
      message: "A layer artifact must be declared with the layerRev it is.",
      keys: ["layer"],
    });
  }
  if (nullableStringOf(body, "branch") === "HEAD") {
    problems.push({
      code: "BRANCH_INVALID",
      message: "'HEAD' is not a branch.",
    });
  }
  const bad = artifacts
    .filter((artifact) => !/^[0-9a-f]{64}$/.test(artifact.sha256))
    .map((artifact) => artifact.key);
  if (bad.length > 0) {
    problems.push({
      code: "ARTIFACT_SHA_INVALID",
      message: "sha256 must be 64 lowercase hex characters.",
      keys: bad,
    });
  }
  return problems;
}

function send(res: http.ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseJson(body: Buffer): unknown {
  return body.length === 0 ? {} : JSON.parse(body.toString("utf-8"));
}

function stringOf(body: unknown, key: string): string {
  const value = nullableStringOf(body, key);
  if (value === null) {
    throw new Error(`Fake content service: no ${key} in the body`);
  }
  return value;
}

function nullableStringOf(body: unknown, key: string): string | null {
  if (typeof body === "object" && body !== null) {
    const value = Reflect.get(body, key);
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
}

function artifactsOf(body: unknown): Artifact[] {
  if (typeof body !== "object" || body === null) {
    throw new Error("Fake content service: no body");
  }
  const raw = Reflect.get(body, "artifacts");
  if (!Array.isArray(raw)) {
    throw new Error("Fake content service: no artifacts");
  }
  return raw.map((entry) => ({
    key: stringOf(entry, "key"),
    sha256: stringOf(entry, "sha256"),
    bytes:
      typeof entry === "object" && entry !== null
        ? Number(Reflect.get(entry, "bytes"))
        : 0,
  }));
}
