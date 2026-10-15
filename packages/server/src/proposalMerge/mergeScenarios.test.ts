import { initVal } from "@valbuild/core";
import { world } from "./world";

const { s, c } = initVal();

/*
 * Publishing a proposal while editors have pending changes on the site
 * (valbuild/home `docs/hosted-publishing.md`, step 8.2). Publishing is never
 * blocked by them: a pending change that conflicts with the merge moves into a
 * proposal, which starts where the site was, so its conflict is shown there.
 *
 * Every branch is Val's real in-memory server; see `world.ts`.
 */
/*
 * The world on its own, before any merge: what the scenarios stand on. Val's
 * real server takes the change, shows it in the draft, and leaves the
 * published page alone.
 */
test("the world: a change on the site is pending, and in the draft only", async () => {
  const about = c.define("/about.val.ts", s.object({ heading: s.string() }), {
    heading: "About us",
  });
  const w = await world([about]);
  await w
    .onSite("kari")
    .patch(about, [{ op: "replace", path: ["heading"], value: "Who we are" }]);
  expect(await w.site.pending()).toEqual(["kari-1"]);
  expect(await w.site.draft(about)).toEqual({ heading: "Who we are" });
  expect(await w.site.page(about)).toEqual({ heading: "About us" });
});

describe("publishing a proposal over the site's pending changes", () => {
  // Failing until `mergePlan` is built: switch to `test` once it passes.
  test.failing(
    "1. different pages: Kari's pending change on About stays on the site",
    async () => {
      const home = c.define(
        "/home.val.ts",
        s.object({ title: s.string(), hero: s.string() }),
        { title: "Sale", hero: "a.png" },
      );
      const about = c.define(
        "/about.val.ts",
        s.object({ heading: s.string() }),
        { heading: "About us" },
      );
      const w = await world([home, about]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [
        { op: "replace", path: ["title"], value: "Summer sale" },
      ]);
      await w
        .onSite("kari")
        .patch(about, [
          { op: "replace", path: ["heading"], value: "Who we are" },
        ]);

      const published = await w.publish(summer);

      // Ola is not blocked, and has nothing to resolve.
      expect(published).toMatchObject({ status: "published", conflicts: [] });
      // The site has the proposal's home page, and About as it was published...
      expect(await w.site.page(home)).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      expect(await w.site.page(about)).toEqual({ heading: "About us" });
      // ...and Kari's change is still pending on the site, untouched: editors
      // there still see it, and the site's next Publish ships it.
      expect(await w.site.pending()).toEqual(["kari-1"]);
      expect(await w.site.draft(about)).toEqual({ heading: "Who we are" });
      // Nothing moved, so the only proposal is the one that was published.
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "merged" }),
      ]);
    },
  );

  // Failing until `mergePlan` is built: switch to `test` once it passes.
  test.failing(
    "3. same field: Kari's pending title moves into a proposal of her own",
    async () => {
      const home = c.define(
        "/home.val.ts",
        s.object({ title: s.string(), hero: s.string() }),
        { title: "Sale", hero: "a.png" },
      );
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [
        { op: "replace", path: ["title"], value: "Summer sale" },
      ]);
      await w
        .onSite("kari")
        .patch(home, [
          { op: "replace", path: ["title"], value: "Spring sale" },
        ]);

      const published = await w.publish(summer);

      // Ola is not blocked, and has nothing to resolve.
      expect(published).toMatchObject({ status: "published", conflicts: [] });
      // The site shows the proposal's title...
      expect(await w.site.page(home)).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      // ...and Kari's change is no longer pending there, where publishing the
      // site would have silently put "Spring sale" back over it.
      expect(await w.site.pending()).toEqual([]);
      expect(await w.site.draft(home)).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      // It is in a proposal Kari owns, which starts where the site was before
      // the merge -- so "Summer sale" is a change on the site since, and her
      // title is a conflict she resolves there.
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "merged" }),
        {
          name: "Moved when “Summer campaign” was published",
          owners: ["kari"],
          startsAt: published.status === "published" ? published.before : "",
          changes: ["kari-1"],
          status: "open",
        },
      ]);
    },
  );
});
