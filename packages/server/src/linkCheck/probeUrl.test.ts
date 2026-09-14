import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { AddressInfo } from "node:net";
import { probeUrl } from "./probeUrl";

/**
 * A stand-in for `https.request` that answers from a script.
 *
 * Only the redirect, fallback and status logic goes through this. The address
 * guard is deliberately NOT bypassable from here — the tests that prove it
 * works open a real socket, below.
 */
type Answer = { status: number; location?: string };

function fakeTransport(answers: Answer[]) {
  const calls: { url: string; method: string }[] = [];
  const request = ((options, callback) => {
    const opts = options as http.RequestOptions;
    calls.push({
      url: `${opts.protocol}//${opts.hostname}${opts.path}`,
      method: opts.method ?? "GET",
    });
    const req = new EventEmitter() as unknown as http.ClientRequest;
    (req as unknown as { end: () => void }).end = () => {
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      const res = new EventEmitter() as unknown as http.IncomingMessage;
      Object.assign(res, {
        statusCode: answer.status,
        headers: answer.location ? { location: answer.location } : {},
        destroy: () => undefined,
      });
      // Asynchronous, as a real response is: a synchronous callback would let
      // a bug in the settle-once guard go unnoticed.
      setTimeout(() => {
        if (typeof callback === "function") callback(res);
      }, 0);
    };
    return req;
  }) as typeof https.request;
  return { request, calls };
}

describe("reading what answered", () => {
  test("a 200 is an answer, with the URL that gave it", async () => {
    const { request, calls } = fakeTransport([{ status: 200 }]);
    const result = await probeUrl("https://example.com/a", { request });
    expect(result).toMatchObject({
      kind: "answered",
      code: 200,
      finalUrl: "https://example.com/a",
    });
    expect(calls).toEqual([{ url: "https://example.com/a", method: "HEAD" }]);
  });

  test("a 404 is an answer too, not a failure", async () => {
    const { request } = fakeTransport([{ status: 404 }]);
    expect(
      await probeUrl("https://example.com/gone", { request }),
    ).toMatchObject({ kind: "answered", code: 404 });
  });

  test("HEAD falls back to GET only where the METHOD was refused", async () => {
    const { request, calls } = fakeTransport([
      { status: 405 },
      { status: 200 },
    ]);
    const result = await probeUrl("https://example.com/", { request });
    expect(result).toMatchObject({ kind: "answered", code: 200 });
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  test("a 403 is an answer about the URL, so it is not retried with GET", async () => {
    const { request, calls } = fakeTransport([{ status: 403 }]);
    expect(await probeUrl("https://example.com/", { request })).toMatchObject({
      kind: "answered",
      code: 403,
    });
    expect(calls).toHaveLength(1);
  });
});

describe("redirects", () => {
  test("are followed, and the destination is reported", async () => {
    const { request, calls } = fakeTransport([
      { status: 301, location: "https://example.com/new" },
      { status: 200 },
    ]);
    const result = await probeUrl("https://example.com/old", { request });
    expect(result).toMatchObject({
      kind: "answered",
      code: 200,
      finalUrl: "https://example.com/new",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://example.com/old",
      "https://example.com/new",
    ]);
  });

  test("a relative Location resolves against the URL it came from", async () => {
    const { request, calls } = fakeTransport([
      { status: 302, location: "/moved" },
      { status: 200 },
    ]);
    await probeUrl("https://example.com/deep/page", { request });
    expect(calls[1].url).toBe("https://example.com/moved");
  });

  test("a loop is given up on rather than followed forever", async () => {
    const { request, calls } = fakeTransport([
      { status: 302, location: "https://example.com/loop" },
    ]);
    const result = await probeUrl("https://example.com/loop", {
      request,
      maxRedirects: 3,
    });
    expect(result).toMatchObject({ kind: "unreachable" });
    expect(calls).toHaveLength(4); // the first, plus three follows
  });

  test("a redirect out of http(s) is refused", async () => {
    // The address guard never sees a `file:` URL, so the scheme has to be
    // re-checked on every hop rather than only on the one the caller gave.
    const { request } = fakeTransport([
      { status: 302, location: "file:///etc/passwd" },
    ]);
    const result = await probeUrl("https://example.com/", { request });
    expect(result).toMatchObject({ kind: "unreachable" });
    expect((result as { message: string }).message).toContain("file:");
  });

  test("a redirect answering HEAD with 405 at the new URL falls back there", async () => {
    const { request, calls } = fakeTransport([
      { status: 301, location: "https://example.com/new" },
      { status: 405 },
      { status: 200 },
    ]);
    expect(
      await probeUrl("https://example.com/old", { request }),
    ).toMatchObject({ kind: "answered", code: 200 });
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "HEAD", "GET"]);
  });
});

describe("keys that are not URLs", () => {
  test("are skipped rather than reported unreachable", async () => {
    expect(await probeUrl("discord.gg/val")).toMatchObject({ kind: "skipped" });
  });

  test("and so is a scheme that cannot be opened", async () => {
    expect(await probeUrl("mailto:hi@example.com")).toMatchObject({
      kind: "skipped",
    });
    expect(await probeUrl("file:///etc/passwd")).toMatchObject({
      kind: "skipped",
    });
  });
});

/**
 * The guard, against a real socket.
 *
 * A test that only checks `blockedAddressReason` proves the list is right and
 * nothing about whether it is CONSULTED. These start a real server on
 * loopback, point the real prober at it, and assert two things: the probe
 * fails, and the server never heard from it. The second half is the one that
 * matters — a check that happens after the request has already been made is
 * not a check.
 */
describe("the address guard, on a real connection", () => {
  let server: http.Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits++;
      res.writeHead(200);
      res.end("should never be reached");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = 0;
  });

  test("a loopback IP is refused, and nothing is sent", async () => {
    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    expect(result.kind).toBe("unreachable");
    expect((result as { message: string }).message).toContain("loopback");
    expect(hits).toBe(0);
  });

  test("so is `localhost`, which RESOLVES to one", async () => {
    // The whole reason the guard is in the lookup: the name says nothing.
    const result = await probeUrl(`http://localhost:${port}/`);
    expect(result.kind).toBe("unreachable");
    expect(hits).toBe(0);
  });

  /**
   * The refusal must not hand back what it refused.
   *
   * The first version of the guard reported "localhost resolves to a loopback
   * address (127.0.0.1)", and that message travels all the way to the dialog.
   * On a name the caller cannot otherwise resolve — `vault.prod.svc`, any
   * split-horizon internal record — that is the endpoint mapping the internal
   * network for them: existence confirmed and address attached, without ever
   * connecting. Twenty names per request.
   *
   * So a lookup-refused URL says only that the host could not be reached,
   * which is true, and which a real dead host says too.
   */
  test("and says nothing about what it resolved to", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await probeUrl(`http://localhost:${port}/`);
      const message = (result as { message: string }).message;
      expect(message).not.toContain("127.0.0.1");
      expect(message).not.toContain("loopback");
      expect(message).not.toContain("resolves");
      expect(message).toBe("the host could not be reached");
      // The operator still gets it, where it is theirs to see.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("127.0.0.1"));
    } finally {
      warn.mockRestore();
    }
  });

  test("a URL the CALLER wrote as an address keeps its specific message", async () => {
    // Nothing is disclosed by repeating `127.0.0.1` to whoever just typed it,
    // and "this is a loopback address" is the useful thing to say about it.
    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    expect((result as { message: string }).message).toContain("loopback");
  });

  test("and the IPv6 spelling of it, for the RIGHT reason", async () => {
    // Asserting the message, not just the failure: `::1` would also fail with
    // a connection error here (the server binds IPv4 only), and a test that
    // accepted that would pass with the guard removed.
    const result = await probeUrl(`http://[::1]:${port}/`);
    expect(result.kind).toBe("unreachable");
    expect((result as { message: string }).message).toContain("loopback");
    expect(hits).toBe(0);
  });

  test("a redirect INTO loopback is refused at that hop", async () => {
    /*
     * The attack this whole module exists for: a URL an editor is allowed to
     * check, on a host the attacker controls, answering 302 to something only
     * the server can reach. The first hop is a public site and is followed;
     * the second is refused before a socket is opened, which is why the local
     * server hears nothing.
     *
     * The transport is faked so the SECOND hop would succeed if it were ever
     * attempted — the fake answers 200 to anything after the redirect. So
     * "unreachable" here can only come from the guard.
     */
    const { request, calls } = fakeTransport([
      { status: 302, location: `http://127.0.0.1:${port}/admin` },
      { status: 200 },
    ]);
    const result = await probeUrl("https://example.com/", { request });
    expect(result.kind).toBe("unreachable");
    expect((result as { message: string }).message).toContain("loopback");
    // The redirect was read, and then nothing else was sent.
    expect(calls).toHaveLength(1);
    expect(hits).toBe(0);
  });

  test("the cloud metadata address is refused by name resolution too", async () => {
    const result = await probeUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.kind).toBe("unreachable");
    expect((result as { message: string }).message).toContain("link-local");
  });
});
