import crypto from "crypto";
import http from "http";

/**
 * A local stand-in for content.val.build's publish API.
 *
 * It implements the whole protocol - the token exchange, the five publish
 * calls, and a storage endpoint the presigned URLs point at - over real HTTP,
 * so `val publish` runs against it exactly as it runs against the service: one
 * `VAL_CONTENT_URL` and nothing stubbed inside the CLI.
 *
 * Two things it does for real, because they are the two the CLI can get
 * wrong on its own:
 *
 * - **It re-hashes what landed.** An artifact whose bytes do not match the
 *   hash the CLI offered comes back in `missing`, which is how a truncated
 *   upload is caught here rather than by a reader of the live site.
 * - **It only presigns what it does not have.** Publishing the same build
 *   twice uploads nothing the second time, which is the property that makes a
 *   one-line change a one-chunk publish.
 *
 * Run it by hand to publish against nothing:
 *
 *     const fake = await startFakeContentService({});
 *     VAL_CONTENT_URL=<fake.url> VAL_PROJECT_TOKEN=val_pt_x npx val publish
 */
export type FakeContentOptions = {
  /** Hashes it already holds, so their artifacts are never asked for. */
  have?: string[];
  /** The token it accepts. Any token is accepted when absent. */
  token?: string;
  /**
   * Swallow the first N uploads: accept the PUT, store nothing. This is a
   * dropped connection that looks like a success, which is the failure the
   * re-hash exists to catch.
   */
  dropUploads?: number;
  /** Answer this many uploads with a 500 before accepting any. */
  failUploadsWith5xx?: number;
  /**
   * What verifying does: pass, fail with problems, or take `verifyPolls`
   * polls of `GET /v1/publish/{id}` to finish.
   */
  verify?: "ok" | "fail";
  verifyPolls?: number;
  promote?: "ok" | "fail";
};

export type FakeContentService = {
  url: string;
  /** Every request it answered: method, path, and the bearer it was given. */
  calls: Array<{ method: string; path: string; authorization: string | null }>;
  /** What is in storage now, by artifact path. */
  stored: Map<string, Buffer>;
  close: () => Promise<void>;
};

type Publish = {
  id: string;
  commit: string;
  branch: string;
  artifacts: Array<{ path: string; hash: string; size: number }>;
  state: string;
  problems: Array<{ code: string; message: string }>;
  pollsLeft: number;
};

export async function startFakeContentService(
  options: FakeContentOptions,
): Promise<FakeContentService> {
  const have = new Set(options.have ?? []);
  const calls: FakeContentService["calls"] = [];
  const stored = new Map<string, Buffer>();
  const publishes = new Map<string, Publish>();
  let dropsLeft = options.dropUploads ?? 0;
  let failuresLeft = options.failUploadsWith5xx ?? 0;
  let nextId = 1;

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      send(res, 500, { statusCode: 500, message: String(err) });
    });
  });

  const missingOf = (publish: Publish) =>
    publish.artifacts
      .filter((artifact) => !have.has(artifact.hash))
      .map((artifact) => ({
        path: artifact.path,
        hash: artifact.hash,
        url: `${baseUrl()}/storage/${encodeURIComponent(publish.id)}/${encodeURIComponent(
          artifact.path,
        )}`,
        method: "PUT",
        headers: { "x-fake-artifact": artifact.hash },
      }));

  const statusOf = (publish: Publish) => ({
    publishId: publish.id,
    state: publish.state,
    missing: missingOf(publish),
    problems: publish.problems,
    url: publish.state === "published" ? "https://example.test" : null,
  });

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", baseUrl());
    const parts = url.pathname.split("/").filter((part) => part !== "");
    const authorization = req.headers.authorization ?? null;
    calls.push({
      method: req.method ?? "",
      path: url.pathname,
      authorization,
    });

    // Storage. A presigned URL is the one thing here that is not content: it
    // is a URL the CLI was handed, and it carries no credential of ours.
    if (parts[0] === "storage") {
      const body = await readBody(req);
      if (failuresLeft > 0) {
        failuresLeft--;
        send(res, 503, { statusCode: 503, message: "slow down" });
        return;
      }
      if (dropsLeft > 0) {
        dropsLeft--;
        // Accepted, and thrown away.
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
    if (
      options.token !== undefined &&
      authorization !== `Bearer ${options.token}`
    ) {
      send(res, 401, { statusCode: 401, message: "Invalid project token" });
      return;
    }

    // POST /v1/publish
    if (parts.length === 2 && req.method === "POST") {
      const body = parseJson(await readBody(req));
      const publish: Publish = {
        id: `pub_${nextId++}`,
        commit: stringOf(body, "commit"),
        branch: stringOf(body, "branch"),
        artifacts: artifactsOf(body),
        state: "awaiting-artifacts",
        problems: [],
        pollsLeft: 0,
      };
      publishes.set(publish.id, publish);
      send(res, 200, statusOf(publish));
      return;
    }

    const publish = publishes.get(decodeURIComponent(parts[2] ?? ""));
    if (!publish) {
      send(res, 404, { statusCode: 404, message: "No such publish" });
      return;
    }

    // GET /v1/publish/{id}
    if (parts.length === 3 && req.method === "GET") {
      if (publish.pollsLeft > 0) {
        publish.pollsLeft--;
        if (publish.pollsLeft === 0) {
          publish.state = options.verify === "fail" ? "failed" : "verified";
          if (options.verify === "fail") {
            publish.problems = [
              { code: "render", message: "/ threw on the server" },
            ];
          }
        }
      }
      send(res, 200, statusOf(publish));
      return;
    }

    if (req.method !== "POST") {
      send(res, 405, { statusCode: 405, message: "Method not allowed" });
      return;
    }
    await readBody(req);

    // POST /v1/publish/{id}/artifacts - what actually landed, re-hashed.
    if (parts[3] === "artifacts") {
      for (const artifact of publish.artifacts) {
        const bytes = stored.get(artifact.path);
        if (bytes && sha256(bytes) === artifact.hash) {
          have.add(artifact.hash);
        }
      }
      publish.state =
        missingOf(publish).length === 0
          ? "artifacts-received"
          : "awaiting-artifacts";
      send(res, 200, statusOf(publish));
      return;
    }

    // POST /v1/publish/{id}/verify - a canary build and render, server side.
    if (parts[3] === "verify") {
      const polls = options.verifyPolls ?? 0;
      if (polls > 0) {
        publish.state = "verifying";
        publish.pollsLeft = polls;
      } else if (options.verify === "fail") {
        publish.state = "failed";
        publish.problems = [
          { code: "render", message: "/ threw on the server" },
        ];
      } else {
        publish.state = "verified";
      }
      send(res, 200, statusOf(publish));
      return;
    }

    // POST /v1/publish/{id}/promote - the pointer moves, or it does not.
    if (parts[3] === "promote") {
      if (options.promote === "fail") {
        publish.state = "failed";
        publish.problems = [
          { code: "head-moved", message: "The branch has moved on since" },
        ];
      } else {
        publish.state = "published";
      }
      send(res, 200, statusOf(publish));
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
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
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
  if (body.length === 0) {
    return {};
  }
  return JSON.parse(body.toString("utf-8"));
}

function stringOf(body: unknown, key: string): string {
  if (typeof body === "object" && body !== null) {
    const value = Reflect.get(body, key);
    if (typeof value === "string") {
      return value;
    }
  }
  throw new Error(`Fake content service: no ${key} in the body`);
}

function artifactsOf(
  body: unknown,
): Array<{ path: string; hash: string; size: number }> {
  if (typeof body !== "object" || body === null) {
    throw new Error("Fake content service: no body");
  }
  const raw = Reflect.get(body, "artifacts");
  if (!Array.isArray(raw)) {
    throw new Error("Fake content service: no artifacts");
  }
  return raw.map((entry) => ({
    path: stringOf(entry, "path"),
    hash: stringOf(entry, "hash"),
    size:
      typeof entry === "object" && entry !== null
        ? Number(Reflect.get(entry, "size"))
        : 0,
  }));
}
