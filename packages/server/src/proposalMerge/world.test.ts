import type { PatchId } from "@valbuild/core";
import type { BaseSha } from "../ValOps";
import { content, SITE } from "./content";
import { buildName, scaffold } from "./project";
import { world } from "./world";
import { aboutPage, HERO, hero, HOME_SCHEMA, homePage, set } from "./fixtures";

/*
 * The world on its own, before any merge decision: what is real here is
 * Val's loader, its patches and its prepare, and what is modelled is
 * content's lines, saves, staging, builds and squash. These run on a site that
 * has not moved, so Val's two merge answers (`merge.ts`) are never asked.
 */

describe("the site", () => {
  test("a change is pending, and in the draft only", async () => {
    const home = homePage();
    const w = await world([home]);
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

    expect(w.site.pending()).toEqual(["kari-1"]);
    expect(await w.site.draft(home)).toMatchObject({ title: "Spring sale" });
    expect(await w.site.page(home)).toMatchObject({ title: "Sale" });
  });

  test("Publish rewrites the .val.ts through Val's prepare, and the change is published", async () => {
    const home = homePage();
    const w = await world([home]);
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

    expect(await w.publishSite()).toMatchObject({ ids: ["kari-1"] });

    expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
    expect(w.site.file(home.file)).toContain(`"Spring sale"`);
    expect(w.site.pending()).toEqual([]);
    expect(w.whereIs("kari-1")).toBe("published");
  });
});

describe("a proposal", () => {
  test("a change is pending in it until saved, and the site never sees it", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    expect(w.whereIs("ola-1")).toBe(`in ${summer.id}`);

    await summer.save();

    expect(w.whereIs("ola-1")).toBe(`saved in ${summer.id}`);
    expect(w.proposalFile(summer, home.file)).toContain(`"Summer sale"`);
    expect(await w.proposalPage(summer, home)).toMatchObject({
      title: "Summer sale",
    });
    expect(await w.site.draft(home)).toMatchObject({ title: "Sale" });
  });

  test("a staged schema is the schema the proposal's Val loads", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(
        `s.object({ title: s.string(), subtitle: s.string(), hero: s.string(), cta: s.string() })`,
        {
          title: "Sale",
          subtitle: "Everything must go",
          hero: "a.png",
          cta: "Buy now",
        },
      ),
    });

    // The new field can be edited in the proposal: Val validates the change
    // against the schema it loaded from the staged text.
    await summer.patch(home, [set(["cta"], "Shop the sale")]);
    await summer.save();

    expect(await w.proposalPage(summer, home)).toMatchObject({
      cta: "Shop the sale",
    });
    expect(w.proposalFile(summer, home.file)).toContain("cta: s.string()");
    expect(w.site.file(home.file)).not.toContain("cta");
  });

  test("staged code needs a build; content saved over it does not", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    expect(w.buildRequired(summer)).toBe(false);

    summer.stage({ [HERO]: hero("huge") });
    expect(w.buildRequired(summer)).toBe(true);
    summer.build();
    expect(w.buildRequired(summer)).toBe(false);

    // Content is read at request time, so it is no part of a build.
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    expect(w.buildRequired(summer)).toBe(false);
  });

  test("a rename changes the title and nothing else", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    summer.rename("Summer sale, take two");

    expect(w.proposals()).toEqual([
      {
        id: summer.id,
        title: "Summer sale, take two",
        owners: ["ola"],
        base: w.siteHead(),
        changes: ["ola-1"],
        status: "open",
      },
    ]);
    await summer.save();
    expect(await w.publish(summer)).toMatchObject({ status: "published" });
  });

  test("Publish saves what is unsaved first, as the Studio does, and publishes it", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);

    expect(await w.publish(summer)).toMatchObject({ status: "published" });
    expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
    expect(w.whereIs("ola-1")).toBe("published");
  });
});

describe("content, on its own", () => {
  test("refuses to merge a proposal with unsaved changes: the Studio's saving first is not trusted", async () => {
    const home = homePage();
    const c = content(
      {
        ...scaffold([home.file]),
        [home.file]: home.text,
      },
      buildName,
    );
    const id = c.openProposal("Summer campaign", "ola");
    await c.patchStore(c.proposal(id).line).append({
      patchId: "ola-1" as PatchId,
      path: home.moduleFilePath,
      patch: [set(["title"], "Summer sale")],
      authorId: null,
      createdAt: "",
      baseSha: "" as BaseSha,
    });

    expect(() => c.merge(id, { siteHead: c.head(SITE).id, move: [] })).toThrow(
      "unsaved changes",
    );
  });
});

describe("merging, when the site has not moved", () => {
  test("content only: one commit on the site, and no build", async () => {
    const home = homePage();
    const about = aboutPage();
    const w = await world([home, about]);
    const served = w.site.served();
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();

    expect(await w.publish(summer)).toMatchObject({
      status: "published",
      build: "none",
      moved: [],
    });

    expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
    expect(await w.site.page(about)).toEqual({ heading: "About us" });
    expect(w.site.served()).toBe(served);
    expect(w.whereIs("ola-1")).toBe("published");
  });

  test("code the proposal built: its build goes live", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });
    const built = summer.build();

    expect(await w.publish(summer)).toMatchObject({ build: "reused" });

    expect(w.site.file(HERO)).toBe(hero("huge"));
    expect(w.site.served()).toBe(built);
  });

  test("code nobody built: the merge builds it", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const served = w.site.served();
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });

    expect(await w.publish(summer)).toMatchObject({ build: "built" });
    expect(w.site.served()).not.toBe(served);
  });

  test("a schema change and its content go live together, and the site's next change uses the new schema", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(
        `s.object({ title: s.string(), hero: s.string() })`,
        { title: "Sale", hero: "a.png" },
      ),
    });

    expect(await w.publish(summer)).toMatchObject({ build: "built" });
    expect(await w.site.page(home)).toEqual({ title: "Sale", hero: "a.png" });

    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.publishSite();
    expect(await w.site.page(home)).toEqual({
      title: "Spring sale",
      hero: "a.png",
    });
    expect(w.site.file(home.file)).not.toContain("subtitle");
  });

  test("the page as the fixture writes it is a page Val loads", async () => {
    const home = homePage();
    const w = await world([home]);
    expect(await w.site.page(home)).toEqual({
      title: "Sale",
      subtitle: "Everything must go",
      hero: "a.png",
    });
    expect(w.site.file(home.file)).toContain(HOME_SCHEMA);
  });
});
