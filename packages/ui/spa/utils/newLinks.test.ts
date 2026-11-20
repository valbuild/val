import { linksIn, newLinks } from "./newLinks";

describe("newLinks", () => {
  test("a link that was not there before is new, with its site", () => {
    expect(
      newLinks("Read the docs", "Read https://evil.example/?d=draft"),
    ).toEqual([{ url: "https://evil.example/?d=draft", host: "evil.example" }]);
  });

  test("a link that was already there is not", () => {
    expect(
      newLinks(
        "See https://val.build/docs",
        "See https://val.build/docs for more",
      ),
    ).toEqual([]);
  });

  test("a removed link is not a new one", () => {
    expect(newLinks("https://val.build", "")).toEqual([]);
  });

  test("the whole value is new when there was nothing before", () => {
    expect(newLinks(undefined, { href: "http://a.example/x" })).toEqual([
      { url: "http://a.example/x", host: "a.example" },
    ]);
  });

  test("a link's href in rich text counts", () => {
    // The shape `s.richtext({ inline: { a: true } })` stores.
    const body = [
      {
        tag: "p",
        children: [
          "Go ",
          {
            tag: "a",
            href: "https://elsewhere.example/page",
            children: ["here"],
          },
        ],
      },
    ];
    expect(newLinks(null, body)).toEqual([
      { url: "https://elsewhere.example/page", host: "elsewhere.example" },
    ]);
  });

  test("sentence punctuation and brackets are not part of the address", () => {
    expect([
      ...linksIn("Visit https://a.example/x. Or (https://b.example/y), please"),
    ]).toEqual(["https://a.example/x", "https://b.example/y"]);
  });

  test("relative links and other schemes are not counted", () => {
    expect(newLinks(null, "/blog/post mailto:a@b.example ftp://c")).toEqual([]);
  });
});
