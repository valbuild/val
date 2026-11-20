import { expect } from "@playwright/test";
import { openStudio, patchThroughStore, test } from "./studio";
import { expectInsecure, makeInsecure } from "./insecureContext";
import { renderedText, watchForProblems } from "./pageProblems";
import { NEXT_APP_URL } from "./apps";

/*
 * Against `examples/next`, on purpose: the rest of the fs-mode suite drives
 * TanStack, and this is one of the specs that keep `@valbuild/next` covered.
 * The blocking `smoke` CI job runs it, together with `tanstack/`, to gate
 * "the Studio does not come up at all" on both frameworks. See `apps.ts`.
 */
test.use({ baseURL: NEXT_APP_URL });

/**
 * The Studio, opened somewhere that is not a secure context — on Next.
 *
 * `insecureContext.ts` has the why. `tanstack/studio.spec.ts` asks the same
 * question of the TanStack app, and both are needed: the crash was in the
 * shared bundle, but the two apps serve it through different code and it is the
 * serving that is framework-specific.
 *
 * Both halves of the original crash are covered here: mounting (the websocket
 * connection id, minted during render) and editing (`PatchStore.newPatchId`),
 * which is a separate call on a path no render reaches.
 */
test.describe("the Studio outside a secure context", () => {
  test("mounts, renders and can write a patch", async ({ page }) => {
    const problems = watchForProblems(page);

    await makeInsecure(page);
    await openStudio(page);
    await expectInsecure(page);

    expect(await renderedText(page)).toMatch(/valbuild\/val-examples-next/);

    // A patch id is minted on a path no render reaches, so mounting is only
    // half of it. This throws if the store refuses the write.
    await patchThroughStore(page, "/content/tags.val.ts", [
      { op: "replace", path: ["changelog", "label"], value: "Insecure" },
    ]);

    expect(problems.thrown, "uncaught in the page").toEqual([]);
  });
});
