import {
  contentServiceAnswered,
  contentServiceName,
  contentServiceUnreachable,
} from "./contentServiceFailure";

/**
 * The sentences a person reads when the content service let them down.
 *
 * The rule they pin is CLAUDE.md's "Don't blame them for our failures": an
 * answer from the service means the network worked, so nothing here may say
 * "check your connection" -- and an unreachable service is unreachable from the
 * SITE'S server, which is not the editor's connection either.
 */
describe("content service failures", () => {
  test("Val Build is named as Val Build", () => {
    expect(contentServiceName("https://content.val.build")).toBe("Val Build");
  });

  test("any other content service is named by its host", () => {
    expect(contentServiceName("http://localhost:4568")).toBe(
      "the content service at localhost:4568",
    );
  });

  test("a 500 says the service answered with an error, and keeps what it said", () => {
    const failure = contentServiceAnswered("Val Build", "save your change", {
      status: 500,
      statusText: "Internal Server Error",
      body: JSON.stringify({
        message: "Internal Server Error",
        details: 'column "first_paid_at" does not exist',
      }),
    });
    expect(failure.message).toBe(
      "Val Build answered with an error, so Val could not save your change.",
    );
    expect(failure.details).toBe(
      'HTTP 500 Internal Server Error from Val Build: Internal Server Error: column "first_paid_at" does not exist',
    );
    expect(failure.retryable).toBe(true);
  });

  test("a 4xx is a refusal, and retrying it cannot help", () => {
    const failure = contentServiceAnswered(
      "the content service at localhost:4568",
      "load your changes",
      { status: 404, statusText: "Not Found", body: "" },
    );
    expect(failure.message).toBe(
      "The content service at localhost:4568 refused to load your changes.",
    );
    expect(failure.details).toBe(
      "HTTP 404 Not Found from the content service at localhost:4568",
    );
    expect(failure.retryable).toBe(false);
  });

  test("a text body is passed on as it came, and a long one is cut", () => {
    const failure = contentServiceAnswered("Val Build", "publish", {
      status: 502,
      statusText: "Bad Gateway",
      body: "x".repeat(2000),
    });
    expect(failure.details.length).toBeLessThan(600);
    expect(failure.details.endsWith("…")).toBe(true);
  });

  test("no answer at all is unreachable, from the site's server, with its cause", () => {
    const failure = contentServiceUnreachable(
      "Val Build",
      "save your change",
      new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND content.val.build"),
      }),
    );
    expect(failure.message).toBe(
      "Val Build could not be reached from this site's server, so Val could not save your change.",
    );
    expect(failure.details).toBe(
      "fetch failed: getaddrinfo ENOTFOUND content.val.build",
    );
    expect(failure.retryable).toBe(true);
  });

  test("none of them blames the editor's network", () => {
    const all = [
      contentServiceAnswered("Val Build", "load your changes", {
        status: 500,
        statusText: "",
        body: "",
      }),
      contentServiceAnswered("Val Build", "load your changes", {
        status: 400,
        statusText: "",
        body: "",
      }),
      contentServiceUnreachable("Val Build", "load your changes", "boom"),
    ];
    for (const failure of all) {
      expect(failure.message).not.toMatch(/network|your connection/i);
    }
  });
});
