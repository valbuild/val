import { initVal } from "@valbuild/core";
import { page, world } from "./testing/world";

const { s } = initVal();

/*
 * Publishing a proposal while editors have pending changes on the site
 * (valbuild/home `docs/hosted-publishing.md`, step 8.2). Publishing is never
 * blocked by them: a pending change that conflicts with the merge moves into a
 * proposal, which starts where the site was, so its conflict is shown there.
 */
describe("publishing a proposal over the site's pending changes", () => {
  // Failing until `mergePlan` is built: switch to `test` once it passes.
  test.failing(
    "3. same field: Kari's pending title moves into a proposal of her own",
    () => {
      const w = world({
        "/home.val.ts": page(
          s.object({ title: s.string(), hero: s.string() }),
          {
            title: "Sale",
            hero: "a.png",
          },
        ),
      });
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      summer.set("/home.val.ts", ["title"], "Summer sale");
      w.onSite("kari").set("/home.val.ts", ["title"], "Spring sale");

      const published = w.publish(summer);

      // Ola is not blocked, and has nothing to resolve.
      expect(published).toMatchObject({ status: "published", conflicts: [] });
      // The site shows the proposal's title...
      expect(w.site.page("/home.val.ts")).toEqual({
        title: "Summer sale",
        hero: "a.png",
      });
      // ...and Kari's change is no longer pending there, where publishing the
      // site would have silently put "Spring sale" back over it.
      expect(w.site.pending()).toEqual([]);
      expect(w.site.draft("/home.val.ts")).toEqual({
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
