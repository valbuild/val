/** @jest-environment jsdom */
import { initVal } from "@valbuild/core";
import { stegaEncode, type ResolvedVal } from "./stegaEncode";
import {
  findStegaLeaks,
  isReactDevelopmentBuild,
  stegaLeakMessage,
  watchStegaLeaks,
  type StegaLeak,
} from "./stegaLeaks";

const { s, c } = initVal();

const blogVal = c.define(
  "/content/blog.val.ts",
  s.object({ title: s.string(), intro: s.string() }),
  { title: "Hello", intro: "An intro" },
);
const blog: ResolvedVal<typeof blogVal> = stegaEncode(blogVal, {});
const TITLE = '/content/blog.val.ts?p="title"';
const INTRO = '/content/blog.val.ts?p="intro"';

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("findStegaLeaks", () => {
  test("a clean page has none", () => {
    document.title = "Hello";
    document.body.innerHTML = `<p data-val-path='${TITLE}'>Hello</p>`;
    expect(findStegaLeaks(document)).toEqual([]);
  });

  test("JSON-LD, the title and a share link each name the content that leaked", () => {
    document.title = blog.title;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    meta.setAttribute("content", blog.intro);
    document.head.append(meta);
    const jsonLd = document.createElement("script");
    jsonLd.type = "application/ld+json";
    jsonLd.textContent = JSON.stringify({ headline: blog.title });
    document.head.append(jsonLd);
    const share = document.createElement("a");
    share.id = "share";
    share.href = `https://x.com/intent/post?text=${encodeURIComponent(blog.intro)}`;
    document.body.append(share);

    expect(findStegaLeaks(document)).toEqual<StegaLeak[]>([
      { path: TITLE, where: "<title>" },
      {
        path: INTRO,
        where: 'the content attribute of <meta name="description">',
      },
      { path: TITLE, where: '<script type="application/ld+json">' },
      { path: INTRO, where: 'the href attribute of <a id="share">' },
    ]);
  });

  test("text on the page that did not go through React's JSX", () => {
    const p = document.createElement("p");
    p.textContent = `Read: ${blog.title}`;
    document.body.append(p);
    expect(findStegaLeaks(document)).toEqual<StegaLeak[]>([
      { path: TITLE, where: "text in <p>" },
    ]);
  });

  test("the same content in the same place is one leak", () => {
    for (let i = 0; i < 3; i++) {
      const p = document.createElement("p");
      p.textContent = blog.title;
      document.body.append(p);
    }
    expect(findStegaLeaks(document)).toHaveLength(1);
  });

  test("the message says where, what, and what to do", () => {
    expect(
      stegaLeakMessage({
        path: TITLE,
        where: '<script type="application/ld+json">',
      }),
    ).toBe(
      `Content from ${TITLE} reached <script type="application/ld+json"> with its edit tag still in it. Wrap the value in val.raw() where it leaves React.`,
    );
  });
});

test("the tests run React's development build, and know it", () => {
  expect(isReactDevelopmentBuild()).toBe(true);
});

describe("watchStegaLeaks", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("reports after the page settles, each leak once, and again for a new one", async () => {
    const reported: StegaLeak[] = [];
    const stop = watchStegaLeaks((leak) => reported.push(leak), {
      settleMs: 100,
    });
    document.title = blog.title;
    await Promise.resolve();
    expect(reported).toEqual([]);
    jest.advanceTimersByTime(100);
    expect(reported).toEqual([{ path: TITLE, where: "<title>" }]);

    // A route change: a new page, and the old leak still there.
    const p = document.createElement("p");
    p.textContent = blog.intro;
    document.body.append(p);
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    expect(reported).toEqual([
      { path: TITLE, where: "<title>" },
      { path: INTRO, where: "text in <p>" },
    ]);

    stop();
    document.body.append(document.createElement("hr"));
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    expect(reported).toHaveLength(2);
  });
});
