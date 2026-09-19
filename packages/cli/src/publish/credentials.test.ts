import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { resolvePublishCredential } from "./credentials";

/**
 * A fake content service.
 *
 * `val publish` talks to content and to nothing else, so a fake that answers
 * content's routes is the whole world the command needs - no loader, no
 * storage, no credential that has to be real. It records what it was asked so a
 * test can assert on the headers, which is where the interesting rules live:
 * the personal access token goes in `x-val-pat` and never anywhere else.
 */
type FakeContent = {
  url: string;
  requests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
  }>;
  close: () => Promise<void>;
};

async function startFakeContent(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<FakeContent> {
  const requests: FakeContent["requests"] = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
    });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake content service did not get a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function json(res: http.ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A project root, optionally holding the file `val login` writes. */
function makeRoot(pat?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-publish-"));
  if (pat !== undefined) {
    fs.mkdirSync(path.join(root, ".val"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".val", "pat.json"),
      JSON.stringify({ pat }),
    );
  }
  return root;
}

const A_PAT = "a".repeat(64);

describe("the publish credential", () => {
  test("VAL_PROJECT_TOKEN is used as it is, without an exchange", async () => {
    const content = await startFakeContent((_req, res) => {
      json(res, 500, { statusCode: 500, message: "should not be called" });
    });
    try {
      const resolved = await resolvePublishCredential({
        root: makeRoot(A_PAT),
        project: "acme/site",
        env: {
          VAL_PROJECT_TOKEN: "val_pt_deadbeef",
          VAL_CONTENT_URL: content.url,
        },
      });

      expect(resolved).toEqual({
        status: "ok",
        credential: {
          token: "val_pt_deadbeef",
          origin: "VAL_PROJECT_TOKEN",
          expiresAt: null,
        },
      });
      // The token names its project, so there is nothing to ask and nobody to
      // ask it of. A repository that holds one secret holds no variables.
      expect(content.requests).toEqual([]);
    } finally {
      await content.close();
    }
  });

  test("an unset CI secret reads as no credential, not as a bad one", async () => {
    // An unset secret reaches the job as "", and "" presented to content is a
    // 401 that sends the reader looking for a revoked token.
    const resolved = await resolvePublishCredential({
      root: makeRoot(),
      project: "acme/site",
      env: { VAL_PROJECT_TOKEN: "   " },
    });

    expect(resolved.status).toBe("error");
    if (resolved.status === "error") {
      expect(resolved.message).toContain("VAL_PROJECT_TOKEN");
      expect(resolved.message).toContain("val login");
    }
  });

  test("a personal access token pasted into VAL_PROJECT_TOKEN is named as one", async () => {
    const resolved = await resolvePublishCredential({
      root: makeRoot(),
      project: "acme/site",
      env: { VAL_PROJECT_TOKEN: A_PAT },
    });

    expect(resolved.status).toBe("error");
    if (resolved.status === "error") {
      expect(resolved.message).toContain("personal access token");
      expect(resolved.message).toContain("val_pt_");
    }
  });

  test("a val login is exchanged for a project token, and the login stays here", async () => {
    const content = await startFakeContent((req, res) => {
      if (req.url === "/v1/acme/site/publish-token") {
        json(res, 200, {
          token: "val_pt_minted",
          expiresAt: "2026-09-19T12:10:00.000Z",
          publicProjectId: "p1",
          productionUrl: "https://site.example",
        });
        return;
      }
      json(res, 404, { statusCode: 404, message: "no such route" });
    });
    try {
      const resolved = await resolvePublishCredential({
        root: makeRoot(A_PAT),
        project: "acme/site",
        env: { VAL_CONTENT_URL: content.url },
      });

      expect(resolved).toEqual({
        status: "ok",
        credential: {
          token: "val_pt_minted",
          origin: "val login",
          expiresAt: "2026-09-19T12:10:00.000Z",
        },
      });
      expect(content.requests).toHaveLength(1);
      const [request] = content.requests;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/v1/acme/site/publish-token");
      // The person's credential is presented to val.build and to nothing
      // further: what publishes is the ten minute token that came back.
      expect(request.headers["x-val-pat"]).toBe(A_PAT);
      expect(request.headers.authorization).toBeUndefined();
    } finally {
      await content.close();
    }
  });

  test("a trailing slash on VAL_CONTENT_URL does not double the path", async () => {
    const content = await startFakeContent((req, res) => {
      if (req.url === "/v1/acme/site/publish-token") {
        json(res, 200, { token: "val_pt_minted", expiresAt: null });
        return;
      }
      json(res, 404, { statusCode: 404, message: "no such route" });
    });
    try {
      const resolved = await resolvePublishCredential({
        root: makeRoot(A_PAT),
        project: "acme/site",
        env: { VAL_CONTENT_URL: `${content.url}/` },
      });

      expect(resolved.status).toBe("ok");
      expect(content.requests[0].url).toBe("/v1/acme/site/publish-token");
    } finally {
      await content.close();
    }
  });

  test("a login with no project says which of the two is missing", async () => {
    const resolved = await resolvePublishCredential({
      root: makeRoot(A_PAT),
      project: null,
      env: {},
    });

    expect(resolved.status).toBe("error");
    if (resolved.status === "error") {
      expect(resolved.message).toContain("VAL_PROJECT");
      expect(resolved.message).toContain("val.config");
    }
  });

  test("an expired login says to log in again, not that the project is wrong", async () => {
    const content = await startFakeContent((_req, res) => {
      json(res, 401, { statusCode: 401, message: "Invalid token" });
    });
    try {
      const resolved = await resolvePublishCredential({
        root: makeRoot(A_PAT),
        project: "acme/site",
        env: { VAL_CONTENT_URL: content.url },
      });

      expect(resolved.status).toBe("error");
      if (resolved.status === "error") {
        expect(resolved.message).toContain("val login");
      }
    } finally {
      await content.close();
    }
  });

  test("a refusal keeps the sentence content wrote", async () => {
    const content = await startFakeContent((_req, res) => {
      json(res, 403, {
        statusCode: 403,
        message: "Your role in this organization may not publish",
      });
    });
    try {
      const resolved = await resolvePublishCredential({
        root: makeRoot(A_PAT),
        project: "acme/site",
        env: { VAL_CONTENT_URL: content.url },
      });

      expect(resolved.status).toBe("error");
      if (resolved.status === "error") {
        expect(resolved.message).toContain(
          "Your role in this organization may not publish",
        );
        expect(resolved.message).toContain("acme/site");
      }
    } finally {
      await content.close();
    }
  });

  test("the old names are still read, after a login and before failing", async () => {
    // This repository's own CI still passes VAL_APP_TOKEN, and a rename that
    // breaks the publisher is a rename that gets reverted. Content says what
    // it thinks of the value; that is not this function's call to make.
    const resolved = await resolvePublishCredential({
      root: makeRoot(),
      project: "acme/site",
      env: { VAL_APP_TOKEN: "val_pt_old" },
    });

    expect(resolved).toEqual({
      status: "ok",
      credential: {
        token: "val_pt_old",
        origin: "VAL_APP_TOKEN",
        expiresAt: null,
      },
    });
  });

  test("a login is preferred to the old names", async () => {
    const content = await startFakeContent((req, res) => {
      if (req.url === "/v1/acme/site/publish-token") {
        json(res, 200, { token: "val_pt_minted", expiresAt: null });
        return;
      }
      json(res, 404, { statusCode: 404, message: "no such route" });
    });
    try {
      const resolved = await resolvePublishCredential({
        root: makeRoot(A_PAT),
        project: "acme/site",
        env: { VAL_APP_TOKEN: "val_pt_old", VAL_CONTENT_URL: content.url },
      });

      expect(resolved.status).toBe("ok");
      if (resolved.status === "ok") {
        expect(resolved.credential.token).toBe("val_pt_minted");
      }
    } finally {
      await content.close();
    }
  });

  test("no credential at all names both ways of having one", async () => {
    const resolved = await resolvePublishCredential({
      root: makeRoot(),
      project: "acme/site",
      env: {},
    });

    expect(resolved.status).toBe("error");
    if (resolved.status === "error") {
      expect(resolved.message).toContain("VAL_PROJECT_TOKEN");
      expect(resolved.message).toContain("val login");
    }
  });

  test("an unreadable login file is a fixable error, not a fall through", async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".val"), { recursive: true });
    fs.writeFileSync(path.join(root, ".val", "pat.json"), "{ not json");

    const resolved = await resolvePublishCredential({
      root,
      project: "acme/site",
      env: {},
    });

    expect(resolved.status).toBe("error");
    if (resolved.status === "error") {
      expect(resolved.message).toContain("pat.json");
      expect(resolved.message).toContain("val login");
    }
  });
});
