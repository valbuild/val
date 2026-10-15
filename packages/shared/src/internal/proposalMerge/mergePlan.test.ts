import { initVal } from "@valbuild/core";
import { world } from "./testing/world";

const { s, c } = initVal();

/*
 * Publishing a proposal while editors have pending changes on the site
 * (valbuild/home `docs/hosted-publishing.md`, step 8.2). Publishing is never
 * blocked by them: a pending change that conflicts with the merge moves into a
 * proposal, which starts where the site was, so its conflict is shown there.
 */
describe("publishing a proposal over the site's pending changes", () => {
  // Failing until `mergePlan` is built: switch to `test` once it passes.
  test.failing(
    "1. different pages: Kari's pending change on About stays on the site",
    () => {
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
      const w = world([home, about]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      summer.patch(home, [
        { op: "replace", path: ["title"], value: "Summer sale" },
      ]);
      w.onSite("kari").patch(about, [
        { op: "replace", path: ["heading"], value: "Who we are" },
      ]);

      const published = w.publish(summer);

      // Ola is not blocked, and has nothing to resolve.
      expect(published).toMatchObject({ status: "published", conflicts: [] });
      // The site has the proposal's home page, and About as it was published...
      expect(w.site.page(home)).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      expect(w.site.page(about)).toEqual({ heading: "About us" });
      // ...and Kari's change is still pending on the site, untouched: editors
      // there still see it, and the site's next Publish ships it.
      expect(w.site.pending()).toEqual(["kari-1"]);
      expect(w.site.draft(about)).toEqual({ heading: "Who we are" });
      // Nothing moved, so the only proposal is the one that was published.
      expect(w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "merged" }),
      ]);
    },
  );

  // Failing until `mergePlan` is built: switch to `test` once it passes.
  test.failing(
    "3. same field: Kari's pending title moves into a proposal of her own",
    () => {
      const home = c.define(
        "/home.val.ts",
        s.object({ title: s.string(), hero: s.string() }),
        { title: "Sale", hero: "a.png" },
      );
      const w = world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      summer.patch(home, [
        { op: "replace", path: ["title"], value: "Summer sale" },
      ]);
      w.onSite("kari").patch(home, [
        { op: "replace", path: ["title"], value: "Spring sale" },
      ]);

      const published = w.publish(summer);

      // Ola is not blocked, and has nothing to resolve.
      expect(published).toMatchObject({ status: "published", conflicts: [] });
      // The site shows the proposal's title...
      expect(w.site.page(home)).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      // ...and Kari's change is no longer pending there, where publishing the
      // site would have silently put "Spring sale" back over it.
      expect(w.site.pending()).toEqual([]);
      expect(w.site.draft(home)).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      // It is in a proposal Kari owns, which starts where the site was before
      // the merge -- so "Summer sale" is a change on the site since, and her
      // title is a conflict she resolves there.
      expect(w.proposals()).toEqual([
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
