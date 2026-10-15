import { world, type PublishOutcome } from "./world";
import { valModulesFile, page } from "./project";
import {
  aboutPage,
  add,
  FOOTER,
  footer,
  HERO,
  hero,
  homePage,
  image,
  mediaPage,
  move,
  notesPage,
  productsPage,
  remove,
  sectionsPage,
  set,
} from "./fixtures";

/*
 * Publishing a proposal like merging a pull request (valbuild/home
 * `docs/hosted-publishing.md`, step 8.2), in http mode's shape: see
 * `world.ts`. A proposal's changes are saved before it is published, as
 * content requires.
 *
 * What they specify is Val's two merge answers (`merge.ts`); content's part
 * is the model in `content.ts`, and the world itself is tested in
 * `world.test.ts`.
 */

/** A publish that moved the site's conflicting changes into one proposal. */
const MOVED_ONE = { status: "published", moved: [expect.any(String)] };

/**
 * The proposal a publish moved changes into, by its id. Its title is a
 * starting point anyone may change, so no scenario reads it.
 */
function movedInto(outcome: PublishOutcome) {
  if (outcome.status !== "published" || outcome.moved.length !== 1) {
    throw new Error(`expected one moved proposal: ${JSON.stringify(outcome)}`);
  }
  return { id: outcome.moved[0] };
}

// --- publishing over the site's pending changes -----------------------------------
//
// Nobody has published since the proposal started; editors have pending
// changes on the site. Publishing is never blocked by them. A pending change
// that conflicts with the merge moves into a proposal of its own, as a whole
// patch set; the rest stays.

describe("publishing a proposal over the site's pending changes", () => {
  test("1. different pages: Kari's pending change on About stays on the site", async () => {
    const home = homePage();
    const about = aboutPage();
    const w = await world([home, about]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(about, [set(["heading"], "Who we are")]);

    expect(await w.publish(summer)).toMatchObject({
      status: "published",
      moved: [],
    });
    expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
    expect(await w.site.page(about)).toEqual({ heading: "About us" });
    expect(w.site.pending()).toEqual(["kari-1"]);
    expect(await w.site.draft(about)).toEqual({ heading: "Who we are" });
  });

  test("2. same page, different fields: Kari's title stays, and the site's next Publish ships both", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["hero"], "b.png")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

    expect(await w.publish(summer)).toMatchObject({ moved: [] });

    expect(await w.site.page(home)).toEqual({
      title: "Sale",
      subtitle: "Everything must go",
      hero: "b.png",
    });
    expect(w.site.pending()).toEqual(["kari-1"]);
    await w.publishSite();
    expect(await w.site.page(home)).toEqual({
      title: "Spring sale",
      subtitle: "Everything must go",
      hero: "b.png",
    });
  });

  test("3. same field: Kari's pending title moves into a proposal of her own", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

    const published = await w.publish(summer);

    // Ola is not blocked, and has nothing to resolve.
    expect(published).toMatchObject(MOVED_ONE);
    const moved = movedInto(published);
    expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
    // Kari's change is no longer pending, where the site's next Publish
    // would have silently put "Spring sale" back over Ola's title.
    expect(w.site.pending()).toEqual([]);
    expect(await w.site.draft(home)).toMatchObject({ title: "Summer sale" });
    // It is in a proposal Kari owns, standing on the site before the merge.
    expect(w.proposals()).toEqual([
      expect.objectContaining({ title: "Summer campaign", status: "merged" }),
      {
        id: moved.id,
        title: expect.any(String),
        owners: ["kari"],
        base: published.status === "published" ? published.before : "",
        changes: ["kari-1"],
        status: "open",
      },
    ]);
    expect(await w.proposalPage(moved, home)).toMatchObject({
      title: "Spring sale",
    });
  });

  test("3b. same field, same value: still a conflict, so Kari's change moves too -- easy to resolve, both sides agree", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Summer sale")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual([]);
  });

  test("4. one change covering two fields, one in conflict: the whole change moves", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(home, [
        set(["title"], "Spring sale"),
        set(["subtitle"], "Fresh for spring"),
      ]);

    const published = await w.publish(summer);
    expect(published).toMatchObject(MOVED_ONE);

    expect(await w.site.draft(home)).toEqual({
      title: "Summer sale",
      subtitle: "Everything must go",
      hero: "a.png",
    });
    expect(await w.proposalPage(movedInto(published), home)).toEqual({
      title: "Spring sale",
      subtitle: "Fresh for spring",
      hero: "a.png",
    });
  });

  test("5. a list both sides reshaped: Kari's added section moves", async () => {
    const sections = sectionsPage();
    const w = await world([sections]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(sections, [move(["sections", "2"], ["sections", "0"])]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(sections, [add(["sections", "3"], { text: "Contact" })]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(await w.site.page(sections)).toEqual({
      sections: [{ text: "Gallery" }, { text: "Hero" }, { text: "Text" }],
    });
    expect(w.site.pending()).toEqual([]);
  });

  test("5b. a list neither side reshaped: edits to different items stay", async () => {
    const sections = sectionsPage();
    const w = await world([sections]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(sections, [set(["sections", "2", "text"], "Photos")]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(sections, [set(["sections", "0", "text"], "Welcome")]);

    expect(await w.publish(summer)).toMatchObject({ moved: [] });
    expect(w.site.pending()).toEqual(["kari-1"]);
    expect(await w.site.draft(sections)).toEqual({
      sections: [{ text: "Welcome" }, { text: "Text" }, { text: "Photos" }],
    });
  });

  test("5c. a pending insert into a list whose item the proposal edited moves", async () => {
    const sections = sectionsPage();
    const w = await world([sections]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(sections, [set(["sections", "1", "text"], "Story")]);
    await summer.save();
    // Inserted first: every item after it is at another position now.
    await w
      .onSite("kari")
      .patch(sections, [add(["sections", "0"], { text: "Banner" })]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(await w.site.page(sections)).toEqual({
      sections: [{ text: "Hero" }, { text: "Story" }, { text: "Gallery" }],
    });
  });

  test("6. a change written on top of a moving one moves with it, and both authors own the proposal", async () => {
    const sections = sectionsPage();
    const w = await world([sections]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(sections, [move(["sections", "2"], ["sections", "0"])]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(sections, [add(["sections", "3"], { text: "Contact" })]);
    // Per edits the section Kari added: one patch set with hers.
    await w
      .onSite("per")
      .patch(sections, [set(["sections", "3", "text"], "Contact us")]);

    const published = await w.publish(summer);
    expect(published).toMatchObject(MOVED_ONE);
    expect(w.proposals()[1]).toMatchObject({
      owners: ["kari", "per"],
      changes: ["kari-1", "per-1"],
    });
    expect(await w.proposalPage(movedInto(published), sections)).toEqual({
      sections: [
        { text: "Hero" },
        { text: "Text" },
        { text: "Gallery" },
        { text: "Contact us" },
      ],
    });
  });

  test("7. two editors with the same field pending: one proposal, owned by both", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.onSite("per").patch(home, [set(["title"], "Easter sale")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.proposals()[1]).toMatchObject({
      owners: ["kari", "per"],
      changes: ["kari-1", "per-1"],
    });
  });

  test("two patch sets in conflict, by two editors: a proposal for each, owned by its authors", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [
      set(["title"], "Summer sale"),
      set(["subtitle"], "Hot deals"),
    ]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.onSite("per").patch(home, [set(["subtitle"], "Fresh deals")]);

    expect(await w.publish(summer)).toMatchObject({
      moved: [expect.any(String), expect.any(String)],
    });
    expect(w.proposals().slice(1)).toEqual([
      expect.objectContaining({ owners: ["kari"], changes: ["kari-1"] }),
      expect.objectContaining({ owners: ["per"], changes: ["per-1"] }),
    ]);
  });

  test("only the conflicting patch set moves: a pending change to another field of the page stays", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.onSite("per").patch(home, [set(["hero"], "b.png")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual(["per-1"]);
    expect(w.proposals()[1]).toMatchObject({ changes: ["kari-1"] });
  });

  describe("a record: entries are merged by key", () => {
    const scenario = async (pending: Parameters<typeof set>[]) => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await summer.save();
      await w.onSite("kari").patch(
        products,
        pending.map(([path, value]) => set(path, value)),
      );
      return { w, summer, products };
    };

    test("a pending change to another entry stays", async () => {
      const { w, summer } = await scenario([
        [["product-2", "name"], "Armchair"],
      ]);
      expect(await w.publish(summer)).toMatchObject({ moved: [] });
      expect(w.site.pending()).toEqual(["kari-1"]);
    });

    test("a pending change to the same field of the same entry moves", async () => {
      const { w, summer } = await scenario([[["product-1", "price"], 90]]);
      expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    });

    test("a pending change to another field of the same entry stays", async () => {
      const { w, summer, products } = await scenario([
        [["product-1", "name"], "Desk lamp"],
      ]);
      expect(await w.publish(summer)).toMatchObject({ moved: [] });
      expect(await w.site.draft(products)).toMatchObject({
        "product-1": { name: "Desk lamp", price: 120 },
      });
    });

    test("a pending removal of the entry the proposal edits moves", async () => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await summer.save();
      await w.onSite("kari").patch(products, [remove(["product-1"])]);

      expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
      expect(await w.site.draft(products)).toMatchObject({
        "product-1": { name: "Lamp", price: 120 },
      });
    });

    test("a pending new entry stays", async () => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await summer.save();
      await w
        .onSite("kari")
        .patch(products, [add(["product-3"], { name: "Rug", price: 50 })]);

      expect(await w.publish(summer)).toMatchObject({ moved: [] });
      expect(await w.site.draft(products)).toEqual({
        "product-1": { name: "Lamp", price: 120 },
        "product-2": { name: "Chair", price: 200 },
        "product-3": { name: "Rug", price: 50 },
      });
    });
  });
});

// --- the site published since the proposal started ---------------------------------
//
// Publish updates the proposal from the site first. Changes to other fields
// combine; the same field is a conflict, and nothing changes anywhere until it
// is resolved.

describe("publishing a proposal after the site published", () => {
  /** Ola's title in a proposal, and Kari's published on the site. */
  const titleOnBothSides = async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.publishSite();
    return { w, summer, home };
  };

  test("9. Kari published first: Ola's publish reports the conflict, and nothing changes", async () => {
    const { w, summer, home } = await titleOnBothSides();
    const site = w.siteHead();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/home.val.ts",
          path: ["title"],
          base: "Sale",
          site: "Spring sale",
          proposal: "Summer sale",
        },
      ],
    });
    expect(w.siteHead()).toBe(site);
    expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
    expect(w.proposals()[0]).toMatchObject({ status: "open" });
  });

  test("9, resolved keeping the proposal's title: Update, then Publish", async () => {
    const { w, summer, home } = await titleOnBothSides();
    expect(
      await w.update(summer, [
        {
          moduleFilePath: home.moduleFilePath,
          path: ["title"],
          keep: "proposal",
        },
      ]),
    ).toMatchObject({ status: "updated", base: w.siteHead() });
    expect(await w.proposalPage(summer, home)).toMatchObject({
      title: "Summer sale",
    });
    expect(await w.publish(summer)).toMatchObject({ status: "published" });
    expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
  });

  test("9, resolved keeping the site's title: the proposal's other changes still ship", async () => {
    const { w, summer, home } = await titleOnBothSides();
    await summer.patch(home, [set(["hero"], "b.png")]);
    await summer.save();
    await w.update(summer, [
      { moduleFilePath: home.moduleFilePath, path: ["title"], keep: "site" },
    ]);
    await w.publish(summer);
    expect(await w.site.page(home)).toEqual({
      title: "Spring sale",
      subtitle: "Everything must go",
      hero: "b.png",
    });
  });

  test("9, resolved with a value of its own, as AI or a developer writes one", async () => {
    const { w, summer, home } = await titleOnBothSides();
    await w.update(summer, [
      {
        moduleFilePath: home.moduleFilePath,
        path: ["title"],
        value: "Spring and summer sale",
      },
    ]);
    await w.publish(summer);
    expect(await w.site.page(home)).toMatchObject({
      title: "Spring and summer sale",
    });
  });

  test("the site published the same title: still a conflict, resolved by keeping either", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Summer sale")]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/home.val.ts",
          path: ["title"],
          base: "Sale",
          site: "Summer sale",
          proposal: "Summer sale",
        },
      ],
    });
    await w.update(summer, [
      { moduleFilePath: home.moduleFilePath, path: ["title"], keep: "site" },
    ]);
    expect(await w.publish(summer)).toMatchObject({ status: "published" });
    expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
  });

  test("an update without a resolution for every conflict changes nothing", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [
      set(["title"], "Summer sale"),
      set(["subtitle"], "Hot deals"),
    ]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(home, [
        set(["title"], "Spring sale"),
        set(["subtitle"], "Fresh deals"),
      ]);
    await w.publishSite();

    expect(
      await w.update(summer, [
        {
          moduleFilePath: home.moduleFilePath,
          path: ["title"],
          keep: "proposal",
        },
      ]),
    ).toEqual({
      status: "conflicts",
      conflicts: [expect.objectContaining({ path: ["subtitle"] })],
    });
    expect(await w.proposalPage(summer, home)).toEqual({
      title: "Summer sale",
      subtitle: "Hot deals",
      hero: "a.png",
    });
  });

  test("the site published another field: they combine, with no resolution", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["hero"], "b.png")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.publishSite();

    expect(await w.publish(summer)).toMatchObject({ status: "published" });
    expect(await w.site.page(home)).toEqual({
      title: "Spring sale",
      subtitle: "Everything must go",
      hero: "b.png",
    });
  });

  test("a record: the site added an entry, the proposal edited another, and both are kept", async () => {
    const products = productsPage();
    const w = await world([products]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(products, [set(["product-1", "price"], 120)]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(products, [add(["product-3"], { name: "Rug", price: 50 })]);
    await w.publishSite();

    await w.publish(summer);
    expect(await w.site.page(products)).toEqual({
      "product-1": { name: "Lamp", price: 120 },
      "product-2": { name: "Chair", price: 200 },
      "product-3": { name: "Rug", price: 50 },
    });
  });

  test("a record: the site removed the entry the proposal edited, which is a conflict", async () => {
    const products = productsPage();
    const w = await world([products]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(products, [set(["product-1", "price"], 120)]);
    await summer.save();
    await w.onSite("kari").patch(products, [remove(["product-1"])]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        expect.objectContaining({
          kind: "field",
          path: ["product-1"],
          site: undefined,
        }),
      ],
    });
  });

  test("a list neither side reshaped: edits to different items combine", async () => {
    const sections = sectionsPage();
    const w = await world([sections]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(sections, [set(["sections", "2", "text"], "Photos")]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(sections, [set(["sections", "0", "text"], "Welcome")]);
    await w.publishSite();

    await w.publish(summer);
    expect(await w.site.page(sections)).toEqual({
      sections: [{ text: "Welcome" }, { text: "Text" }, { text: "Photos" }],
    });
  });

  test("a list the site reshaped while the proposal edited an item: the list is the conflict", async () => {
    const sections = sectionsPage();
    const w = await world([sections]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(sections, [set(["sections", "1", "text"], "Story")]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(sections, [add(["sections", "0"], { text: "Banner" })]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/sections.val.ts",
          path: ["sections"],
          base: [{ text: "Hero" }, { text: "Text" }, { text: "Gallery" }],
          site: [
            { text: "Banner" },
            { text: "Hero" },
            { text: "Text" },
            { text: "Gallery" },
          ],
          proposal: [{ text: "Hero" }, { text: "Story" }, { text: "Gallery" }],
        },
      ],
    });
  });

  test("after an update, the site moving again on another field still combines", async () => {
    const { w, summer, home } = await titleOnBothSides();
    await w.update(summer, [
      {
        moduleFilePath: home.moduleFilePath,
        path: ["title"],
        keep: "proposal",
      },
    ]);
    await w.onSite("per").patch(home, [set(["subtitle"], "Hot deals")]);
    await w.publishSite();

    await w.publish(summer);
    expect(await w.site.page(home)).toEqual({
      title: "Summer sale",
      subtitle: "Hot deals",
      hero: "a.png",
    });
  });
});

// --- the moved proposal -----------------------------------------------------------

describe("a proposal of moved changes", () => {
  test("3, continued: Kari saves her moved proposal, sees the conflict with Ola's title, keeps hers, and publishes", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    const moved = w.proposal(movedInto(await w.publish(summer)).id);
    // Its title is a starting point: Kari names it.
    moved.rename("Spring title");
    await moved.save();
    expect(await w.publish(moved)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/home.val.ts",
          path: ["title"],
          base: "Sale",
          site: "Summer sale",
          proposal: "Spring sale",
        },
      ],
    });
    await w.update(moved, [
      {
        moduleFilePath: home.moduleFilePath,
        path: ["title"],
        keep: "proposal",
      },
    ]);
    expect(await w.publish(moved)).toMatchObject({ status: "published" });
    expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
    expect(w.whereIs("kari-1")).toBe("published");
  });

  test("a moved proposal and changes still pending on the site are independent", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    await summer.patch(home, [set(["title"], "Summer sale")]);
    await summer.save();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.onSite("per").patch(home, [set(["hero"], "b.png")]);
    const moved = movedInto(await w.publish(summer));

    await w.publishSite();
    expect(await w.site.page(home)).toEqual({
      title: "Summer sale",
      subtitle: "Everything must go",
      hero: "b.png",
    });
    expect(w.whereIs("kari-1")).toBe(`in ${moved.id}`);
  });
});

// --- code: components and val.modules.ts -------------------------------------------
//
// Code is merged the way git merges it, file by file: changed on one side,
// that side's; changed on both, a conflict for AI or a developer. A merge
// whose code differs from what the proposal built builds again.

describe("a proposal that changes code", () => {
  test("a component, with content pending on the site: the content stays, and the proposal's build goes live", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });
    const built = summer.build();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

    expect(await w.publish(summer)).toMatchObject({
      build: "reused",
      moved: [],
    });
    expect(w.site.served()).toBe(built);
    expect(w.site.pending()).toEqual(["kari-1"]);
  });

  test("a component, after the site published content: the update changes no code, so the build is reused", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });
    const built = summer.build();
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.publishSite();

    expect(await w.publish(summer)).toMatchObject({ build: "reused" });
    expect(w.site.served()).toBe(built);
    expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
  });

  test("the same component, changed by a proposal merged first: a conflict, resolved with the text, and built again", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });
    summer.build();
    const brand = w.openProposal("Brand refresh", { by: "per" });
    brand.stage({ [HERO]: hero("brand") });
    await w.publish(brand);

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "code",
          file: HERO,
          base: hero("big"),
          site: hero("brand"),
          proposal: hero("huge"),
        },
      ],
    });
    await w.update(summer, [{ file: HERO, text: hero("brand huge") }]);
    expect(w.buildRequired(summer)).toBe(true);
    expect(await w.publish(summer)).toMatchObject({ build: "built" });
    expect(w.site.file(HERO)).toBe(hero("brand huge"));
  });

  test("the same change to a component on both sides: still a conflict", async () => {
    const home = homePage();
    const w = await world([home], { [HERO]: hero("big") });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });
    const brand = w.openProposal("Brand refresh", { by: "per" });
    brand.stage({ [HERO]: hero("huge") });
    await w.publish(brand);

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "code",
          file: HERO,
          base: hero("big"),
          site: hero("huge"),
          proposal: hero("huge"),
        },
      ],
    });
    await w.update(summer, [{ file: HERO, keep: "site" }]);
    // Its code is the site's now: nothing to build.
    expect(await w.publish(summer)).toMatchObject({ build: "none" });
    expect(w.site.file(HERO)).toBe(hero("huge"));
  });

  test("different components on each side: both kept, and the merged code is built", async () => {
    const home = homePage();
    const w = await world([home], {
      [HERO]: hero("big"),
      [FOOTER]: footer("© Shop"),
    });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({ [HERO]: hero("huge") });
    const built = summer.build();
    const legal = w.openProposal("Legal footer", { by: "per" });
    legal.stage({ [FOOTER]: footer("© Shop AS") });
    await w.publish(legal);

    expect(await w.publish(summer)).toMatchObject({ build: "built" });
    expect(w.site.served()).not.toBe(built);
    expect(w.site.file(HERO)).toBe(hero("huge"));
    expect(w.site.file(FOOTER)).toBe(footer("© Shop AS"));
  });

  test("a page added on each side: val.modules.ts conflicts, and the resolution names both", async () => {
    const home = homePage();
    const w = await world([home]);
    const about = aboutPage();
    const faq = page("faq.val.ts", `s.object({ question: s.string() })`, {
      question: "Why?",
    });
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [about.file]: about.text,
      "val.modules.ts": valModulesFile([home.file, about.file]),
    });
    const help = w.openProposal("Help pages", { by: "per" });
    help.stage({
      [faq.file]: faq.text,
      "val.modules.ts": valModulesFile([home.file, faq.file]),
    });
    await w.publish(help);

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        expect.objectContaining({ kind: "code", file: "val.modules.ts" }),
      ],
    });
    await w.update(summer, [
      {
        file: "val.modules.ts",
        text: valModulesFile([home.file, faq.file, about.file]),
      },
    ]);
    await w.publish(summer);
    expect(await w.site.page(about)).toEqual({ heading: "About us" });
    expect(await w.site.page(faq)).toEqual({ question: "Why?" });
  });
});

describe("a proposal that deletes a page", () => {
  /** The proposal takes About out of the project, file and all. */
  const deleteAbout = async () => {
    const home = homePage();
    const about = aboutPage();
    const w = await world([home, about]);
    const tidy = w.openProposal("Tidy up", { by: "ola" });
    tidy.stage({
      [about.file]: null,
      "val.modules.ts": valModulesFile([home.file]),
    });
    return { w, tidy, about, home };
  };

  test("a change to it pending on the site moves", async () => {
    const { w, tidy, about } = await deleteAbout();
    await w.onSite("kari").patch(about, [set(["heading"], "Who we are")]);

    expect(await w.publish(tidy)).toMatchObject(MOVED_ONE);
    expect(w.site.file(about.file)).toBe(null);
    expect(w.site.pending()).toEqual([]);
  });

  test("a change to it the site published: a conflict, and keeping the deletion deletes it", async () => {
    const { w, tidy, about } = await deleteAbout();
    await w.onSite("kari").patch(about, [set(["heading"], "Who we are")]);
    await w.publishSite();

    expect(await w.publish(tidy)).toEqual({
      status: "conflicts",
      conflicts: [
        expect.objectContaining({
          kind: "code",
          file: about.file,
          proposal: null,
        }),
      ],
    });
    await w.update(tidy, [{ file: about.file, keep: "proposal" }]);
    await w.publish(tidy);
    expect(w.site.file(about.file)).toBe(null);
    expect(await w.site.page(about)).toBe(undefined);
  });
});

// --- schema: code and content in one .val.ts ---------------------------------------
//
// A `.val.ts` is code (its schema) and content (`c.define`'s third argument),
// and the two merge apart: the code as code, the content field by field under
// the schema the merge ends with. Content that is no longer valid under it is
// a conflict (the schema check), and a pending change that no longer is moves.

describe("a proposal that changes a schema", () => {
  const WITH_CTA = `s.object({ title: s.string(), subtitle: s.string(), hero: s.string(), cta: s.string() })`;
  const WITHOUT_SUBTITLE = `s.object({ title: s.string(), hero: s.string() })`;

  test("a field added, with a title pending on the site: the title stays, and the site's next Publish writes it into the new file", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(WITH_CTA, {
        title: "Sale",
        subtitle: "Everything must go",
        hero: "a.png",
        cta: "Buy now",
      }),
    });
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

    expect(await w.publish(summer)).toMatchObject({ moved: [] });
    await w.publishSite();
    expect(await w.site.page(home)).toEqual({
      title: "Spring sale",
      subtitle: "Everything must go",
      hero: "a.png",
      cta: "Buy now",
    });
    expect(w.site.file(home.file)).toContain("cta: s.string()");
  });

  test("8. a field removed, with a change to it pending on the site: that change moves, and a change to another field stays", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(WITHOUT_SUBTITLE, {
        title: "Sale",
        hero: "a.png",
      }),
    });
    await w.onSite("kari").patch(home, [set(["subtitle"], "Fresh deals")]);
    await w.onSite("per").patch(home, [set(["title"], "Spring sale")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual(["per-1"]);
    expect(await w.site.draft(home)).toEqual({
      title: "Spring sale",
      hero: "a.png",
    });
    expect(w.proposals()[1]).toMatchObject({ changes: ["kari-1"] });
  });

  test("a field removed that the site published a change to: a conflict, resolved by keeping the proposal's schema", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(WITHOUT_SUBTITLE, {
        title: "Sale",
        hero: "a.png",
      }),
    });
    await w.onSite("kari").patch(home, [set(["subtitle"], "Fresh deals")]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/home.val.ts",
          path: ["subtitle"],
          base: "Everything must go",
          site: "Fresh deals",
          proposal: undefined,
        },
      ],
    });
    await w.update(summer, [
      {
        moduleFilePath: home.moduleFilePath,
        path: ["subtitle"],
        keep: "proposal",
      },
    ]);
    await w.publish(summer);
    expect(await w.site.page(home)).toEqual({ title: "Sale", hero: "a.png" });
  });

  test("a field added while the site published content to the same file: code on one side, content on the other, no conflict", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(WITH_CTA, {
        title: "Sale",
        subtitle: "Everything must go",
        hero: "a.png",
        cta: "Buy now",
      }),
    });
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.publishSite();

    expect(await w.publish(summer)).toMatchObject({ status: "published" });
    expect(await w.site.page(home)).toEqual({
      title: "Spring sale",
      subtitle: "Everything must go",
      hero: "a.png",
      cta: "Buy now",
    });
  });

  test("a field's type changed while the site added an entry of the old type: the schema check, resolved with a value", async () => {
    const products = productsPage();
    const w = await world([products]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [products.file]: products.withSchema(
        `s.record(s.object({ name: s.string(), price: s.string() }))`,
        {
          "product-1": { name: "Lamp", price: "100 kr" },
          "product-2": { name: "Chair", price: "200 kr" },
        },
      ),
    });
    await w
      .onSite("kari")
      .patch(products, [add(["product-3"], { name: "Rug", price: 50 })]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        expect.objectContaining({
          kind: "invalid",
          moduleFilePath: "/products.val.ts",
          path: ["product-3", "price"],
          value: 50,
        }),
      ],
    });
    await w.update(summer, [
      {
        moduleFilePath: products.moduleFilePath,
        path: ["product-3", "price"],
        value: "50 kr",
      },
    ]);
    await w.publish(summer);
    expect(await w.site.page(products)).toMatchObject({
      "product-3": { name: "Rug", price: "50 kr" },
    });
  });

  test("a field's type changed with a change of the old type pending: it moves", async () => {
    const products = productsPage();
    const w = await world([products]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [products.file]: products.withSchema(
        `s.record(s.object({ name: s.string(), price: s.string() }))`,
        {
          "product-1": { name: "Lamp", price: "100 kr" },
          "product-2": { name: "Chair", price: "200 kr" },
        },
      ),
    });
    await w.onSite("kari").patch(products, [set(["product-2", "price"], 250)]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual([]);
  });

  test("a rule tightened, with a pending change it no longer allows: it moves, though no field conflicts", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Short titles", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(
        `s.object({ title: s.string().maxLength(12), subtitle: s.string(), hero: s.string() })`,
        { title: "Sale", subtitle: "Everything must go", hero: "a.png" },
      ),
    });
    await w
      .onSite("kari")
      .patch(home, [set(["title"], "The great spring sale of the year")]);
    await w.onSite("per").patch(home, [set(["hero"], "b.png")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual(["per-1"]);
  });

  test("both sides changed the same schema: the code conflicts, and the content still merges by field", async () => {
    const home = homePage();
    const w = await world([home]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    summer.stage({
      [home.file]: home.withSchema(WITH_CTA, {
        title: "Sale",
        subtitle: "Everything must go",
        hero: "a.png",
        cta: "Buy now",
      }),
    });
    const badges = w.openProposal("Badges", { by: "per" });
    badges.stage({
      [home.file]: home.withSchema(
        `s.object({ title: s.string(), subtitle: s.string(), hero: s.string(), badge: s.string() })`,
        {
          title: "Sale",
          subtitle: "Everything must go",
          hero: "a.png",
          badge: "New",
        },
      ),
    });
    await w.publish(badges);

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [expect.objectContaining({ kind: "code", file: home.file })],
    });
    const both = home.withSchema(
      `s.object({ title: s.string(), subtitle: s.string(), hero: s.string(), cta: s.string(), badge: s.string() })`,
      {
        title: "Sale",
        subtitle: "Everything must go",
        hero: "a.png",
        cta: "Buy now",
        badge: "New",
      },
    );
    await w.update(summer, [{ file: home.file, text: both }]);
    await w.publish(summer);
    expect(await w.site.page(home)).toMatchObject({
      cta: "Buy now",
      badge: "New",
    });
  });
});

// --- .jsonValues(): a record whose entries are files of their own -------------------
//
// Each entry is a `.val.json` beside the module, and the module's `.val.ts`
// names them (`c.json(() => import(...))`). They merge as one record would --
// entry by entry, field by field -- and none of it is code: no build.

describe("a .jsonValues() record", () => {
  const notesWorld = async () => {
    const notes = notesPage();
    const w = await world([notes]);
    const summer = w.openProposal("Summer notes", { by: "ola" });
    return { w, summer, notes };
  };

  test("the site published one field of an entry, the proposal another: they combine, and nothing is built", async () => {
    const { w, summer, notes } = await notesWorld();
    await summer.patch(notes, [set(["a", "body"], "One, rewritten")]);
    await summer.save();
    await w.onSite("kari").patch(notes, [set(["a", "title"], "Primary")]);
    await w.publishSite();

    expect(await w.publish(summer)).toMatchObject({
      status: "published",
      build: "none",
    });
    expect(await w.site.page(notes)).toEqual({
      a: { title: "Primary", body: "One, rewritten" },
      b: { title: "Second", body: "Two" },
    });
    expect(JSON.parse(w.site.file("notes/a.val.json") ?? "null")).toEqual({
      title: "Primary",
      body: "One, rewritten",
    });
  });

  test("the same field of the same entry: a conflict at the entry's field", async () => {
    const { w, summer, notes } = await notesWorld();
    await summer.patch(notes, [set(["a", "title"], "Summer")]);
    await summer.save();
    await w.onSite("kari").patch(notes, [set(["a", "title"], "Spring")]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/notes.val.ts",
          path: ["a", "title"],
          base: "First",
          site: "Spring",
          proposal: "Summer",
        },
      ],
    });
    await w.update(summer, [
      {
        moduleFilePath: notes.moduleFilePath,
        path: ["a", "title"],
        keep: "proposal",
      },
    ]);
    await w.publish(summer);
    expect(await w.site.page(notes)).toMatchObject({ a: { title: "Summer" } });
  });

  test("an entry added on each side: both are kept, each in its own file", async () => {
    const { w, summer, notes } = await notesWorld();
    await summer.patch(notes, [add(["c"], { title: "Third", body: "Three" })]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(notes, [add(["d"], { title: "Fourth", body: "Four" })]);
    await w.publishSite();

    expect(await w.publish(summer)).toMatchObject({ status: "published" });
    expect(await w.site.page(notes)).toEqual({
      a: { title: "First", body: "One" },
      b: { title: "Second", body: "Two" },
      c: { title: "Third", body: "Three" },
      d: { title: "Fourth", body: "Four" },
    });
    expect(w.site.file(notes.file)).toContain("c.json(");
  });

  test("the site removed one entry while the proposal edited another: it stays removed, line and file", async () => {
    const { w, summer, notes } = await notesWorld();
    await summer.patch(notes, [set(["a", "title"], "Summer")]);
    await summer.save();
    await w.onSite("kari").patch(notes, [remove(["b"])]);
    await w.publishSite();

    await w.publish(summer);
    expect(await w.site.page(notes)).toEqual({
      a: { title: "Summer", body: "One" },
    });
    expect(w.site.file(notes.file)).not.toContain("b.val.json");
    expect(w.site.file("notes/b.val.json")).toBe(null);
  });

  test("an entry the proposal removed, which the site changed: a conflict; keeping the removal removes the file", async () => {
    const { w, summer, notes } = await notesWorld();
    await summer.patch(notes, [remove(["a"])]);
    await summer.save();
    await w.onSite("kari").patch(notes, [set(["a", "title"], "Primary")]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        expect.objectContaining({
          kind: "field",
          path: ["a"],
          proposal: undefined,
        }),
      ],
    });
    await w.update(summer, [
      { moduleFilePath: notes.moduleFilePath, path: ["a"], keep: "proposal" },
    ]);
    await w.publish(summer);
    expect(await w.site.page(notes)).toEqual({
      b: { title: "Second", body: "Two" },
    });
    expect(w.site.file("notes/a.val.json")).toBe(null);
  });

  test("pending on the site: a change to another entry stays, a change to the same field moves", async () => {
    const { w, summer, notes } = await notesWorld();
    await summer.patch(notes, [set(["a", "title"], "Summer")]);
    await summer.save();
    await w.onSite("kari").patch(notes, [set(["a", "title"], "Spring")]);
    await w.onSite("per").patch(notes, [set(["b", "body"], "Two, longer")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual(["per-1"]);
    await w.publishSite();
    expect(await w.site.page(notes)).toEqual({
      a: { title: "Summer", body: "One" },
      b: { title: "Second", body: "Two, longer" },
    });
  });
});

// --- media: an image and a file ---------------------------------------------------
//
// A media value is one value -- its path and what describes that file (alt,
// size, hotspot) -- so it never merges field by field: an alt text written for
// one picture does not describe another. `s.video()` and `s.font()` are the
// same kind of value and take the same rule.

describe("media", () => {
  const mediaWorld = async () => {
    const campaign = mediaPage();
    const w = await world([campaign]);
    const summer = w.openProposal("Summer campaign", { by: "ola" });
    return { w, summer, campaign };
  };

  test("the site replaced the image, the proposal changed the title: they combine", async () => {
    const { w, summer, campaign } = await mediaWorld();
    await summer.patch(campaign, [set(["title"], "Summer sale")]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(campaign, [set(["hero"], image("beach", "A beach"))]);
    await w.publishSite();

    await w.publish(summer);
    expect(await w.site.page(campaign)).toMatchObject({
      title: "Summer sale",
      hero: image("beach", "A beach"),
    });
  });

  test("the site replaced the image, the proposal rewrote its alt text: the image is the conflict, whole", async () => {
    const { w, summer, campaign } = await mediaWorld();
    await summer.patch(campaign, [set(["hero", "alt"], "A big sale")]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(campaign, [set(["hero"], image("beach", "A beach"))]);
    await w.publishSite();

    expect(await w.publish(summer)).toEqual({
      status: "conflicts",
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/campaign.val.ts",
          path: ["hero"],
          base: expect.objectContaining({ path: "/public/val/sale.png" }),
          site: image("beach", "A beach"),
          proposal: expect.objectContaining({ alt: "A big sale" }),
        },
      ],
    });
    await w.update(summer, [
      { moduleFilePath: campaign.moduleFilePath, path: ["hero"], keep: "site" },
    ]);
    await w.publish(summer);
    expect(await w.site.page(campaign)).toMatchObject({
      hero: image("beach", "A beach"),
    });
  });

  test("the same image chosen on both sides: still a conflict", async () => {
    const { w, summer, campaign } = await mediaWorld();
    await summer.patch(campaign, [set(["hero"], image("beach", "A beach"))]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(campaign, [set(["hero"], image("beach", "A beach"))]);
    await w.publishSite();

    expect(await w.publish(summer)).toMatchObject({
      status: "conflicts",
      conflicts: [expect.objectContaining({ path: ["hero"] })],
    });
  });

  test("an alt text pending on the site while the proposal replaced the image: it moves", async () => {
    const { w, summer, campaign } = await mediaWorld();
    await summer.patch(campaign, [set(["hero"], image("beach", "A beach"))]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(campaign, [set(["hero", "alt"], "A huge sale")]);
    await w.onSite("per").patch(campaign, [set(["title"], "Big sale")]);

    expect(await w.publish(summer)).toMatchObject(MOVED_ONE);
    expect(w.site.pending()).toEqual(["per-1"]);
  });

  test("a file: replaced in the proposal, while the site published the image -- both kept", async () => {
    const { w, summer, campaign } = await mediaWorld();
    const brochure = {
      path: "/public/val/summer.pdf",
      mimeType: "application/pdf",
    };
    await summer.patch(campaign, [set(["brochure"], brochure)]);
    await summer.save();
    await w
      .onSite("kari")
      .patch(campaign, [set(["hero"], image("beach", "A beach"))]);
    await w.publishSite();

    await w.publish(summer);
    expect(await w.site.page(campaign)).toMatchObject({
      hero: image("beach", "A beach"),
      brochure,
    });
  });
});

// --- not modelled yet ------------------------------------------------------------

describe("not modelled yet", () => {
  test.todo(
    "10. Kari is told in the Studio that her change moved, with Open the proposal (a Studio test)",
  );
  test.todo(
    "a change written on the site after Val named what moves: content refuses the stale answer, and Val asks again (needs the answer and the merge apart in the world)",
  );
  test.todo(
    "code merged line by line, as git does, rather than file by file (decide first: see the question in the plan)",
  );
});
