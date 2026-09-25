import { expect, test, type Page } from "@playwright/test";
import {
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
  writePatch,
} from "./httpMode";

/**
 * A server-rendered draft, read by a build that is BEHIND what was published.
 *
 * `fetchVal` and `useVal` in draft mode ask the server (`PUT /sources/~`), and
 * the server answers with its own build's source plus the patches content
 * gives it for that build's commit. Content answers with exactly the patches
 * that build does NOT contain -- the pending ones, and the ones committed
 * after its commit -- so every one of them has to be applied.
 *
 * The server used to skip the committed ones, on the reasoning that a
 * committed patch is already in the base. That is true of the build AT the
 * head and false of every build behind it: after a publish, while the old
 * build is still what answers (the platform's pointer lags by about a minute
 * per location, and a failed or slow build never moves it at all), a draft
 * showed the previous text -- and a new edit on top of the previous text.
 *
 * This harness is exactly that build. The app runs from `mockcommit0` for the
 * whole run and is never redeployed, so after any publish it is the build the
 * published patches came after.
 *
 * The array cases are the reason the rule has to be exact rather than merely
 * convergent: applying a `replace` twice is invisible, applying a `move` twice
 * reorders the list again.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

const AUTHORS = "/content/authors.val.ts";
const LISTS = "/content/lists.val.ts";
/** `lists.val.ts` as committed in the fixture. */
const KEYWORDS = ["content", "editing", "preview", "publish", "validation"];

/** One module's source, as a server-rendered draft reads it. */
async function draftRead(page: Page, moduleFilePath: string): Promise<unknown> {
  const res = await page.request.put("/api/val/sources/~");
  expect(res.status(), await res.text()).toBe(200);
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("modules" in body) ||
    typeof body.modules !== "object" ||
    body.modules === null
  ) {
    throw new Error(`not a sources response: ${JSON.stringify(body)}`);
  }
  const entry: unknown = Reflect.get(body.modules, moduleFilePath);
  return typeof entry === "object" && entry !== null && "source" in entry
    ? entry.source
    : undefined;
}

test("an edit that is published and not yet built is in a draft", async ({
  page,
}) => {
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["teddy", "name"], value: "Published, not built" },
  ]);
  expect((await publishAll(page, "Publish one edit")).status).toBe("published");

  expect(await draftRead(page, AUTHORS)).toMatchObject({
    teddy: { name: "Published, not built" },
  });
});

test("a published move is applied once, with a pending edit on top", async ({
  page,
}) => {
  await openHttpStudio(page);
  // "content" from the front to the back.
  await writePatch(page, LISTS, [
    { op: "move", from: ["keywords", "0"], path: ["keywords", "4"] },
  ]);
  expect((await publishAll(page, "Reorder the keywords")).status).toBe(
    "published",
  );
  await writePatch(page, LISTS, [
    { op: "add", path: ["keywords", "5"], value: "pending" },
  ]);

  const moved = [...KEYWORDS.slice(1), KEYWORDS[0]];
  expect(await draftRead(page, LISTS)).toMatchObject({
    keywords: [...moved, "pending"],
  });
});

test("two publishes in a row are both in a draft, in order", async ({
  page,
}) => {
  await openHttpStudio(page);
  await writePatch(page, LISTS, [{ op: "remove", path: ["keywords", "0"] }]);
  expect((await publishAll(page, "First")).status).toBe("published");
  await writePatch(page, LISTS, [
    { op: "add", path: ["keywords", "0"], value: "second" },
  ]);
  expect((await publishAll(page, "Second")).status).toBe("published");

  expect(await draftRead(page, LISTS)).toMatchObject({
    keywords: ["second", ...KEYWORDS.slice(1)],
  });
});
