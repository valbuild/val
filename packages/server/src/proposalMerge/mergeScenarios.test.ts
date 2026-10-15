import { initVal } from "@valbuild/core";
import type { JSONValue, Operation } from "@valbuild/core/patch";
import { world } from "./world";

const { s, c } = initVal();

/*
 * Publishing a proposal like merging a pull request (valbuild/home
 * `docs/hosted-publishing.md`, step 8.2).
 *
 * Every branch is Val's real in-memory server, and after everything that moves
 * a change the world checks that nothing was lost: every change ever written
 * is published, pending on the site, or in exactly one open proposal. See
 * `world.ts`.
 *
 * The scenarios are `test.failing` until `mergePlan` is built: switch each to
 * `test` as it starts passing.
 */

// --- the pages -------------------------------------------------------------

const homePage = () =>
  c.define(
    "/home.val.ts",
    s.object({ title: s.string(), subtitle: s.string(), hero: s.string() }),
    { title: "Sale", subtitle: "Everything must go", hero: "a.png" },
  );

const aboutPage = () =>
  c.define("/about.val.ts", s.object({ heading: s.string() }), {
    heading: "About us",
  });

/** A page of sections: a list, where a change names an item by position. */
const sectionsPage = () =>
  c.define(
    "/sections.val.ts",
    s.object({ sections: s.array(s.object({ text: s.string() })) }),
    { sections: [{ text: "Hero" }, { text: "Text" }, { text: "Gallery" }] },
  );

/** Products by key: a record, where a change names an entry by key. */
const productsPage = () =>
  c.define(
    "/products.val.ts",
    s.record(s.object({ name: s.string(), price: s.number() })),
    {
      "product-1": { name: "Lamp", price: 100 },
      "product-2": { name: "Chair", price: 200 },
    },
  );

// --- the changes, as the Studio writes them ----------------------------------

const set = (path: string[], value: JSONValue): Operation => ({
  op: "replace",
  path,
  value,
});
const add = (path: string[], value: JSONValue): Operation => ({
  op: "add",
  path,
  value,
});
/** A change names something to remove or move, never the page itself. */
type Field = [string, ...string[]];
const remove = (path: Field): Operation => ({ op: "remove", path });
const move = (from: Field, path: string[]): Operation => ({
  op: "move",
  from,
  path,
});

const MOVED = "Moved when “Summer campaign” was published";

// --- the world itself ----------------------------------------------------------

describe("the world", () => {
  test("a change on the site is pending, and in the draft only", async () => {
    const about = aboutPage();
    const w = await world([about]);
    await w.onSite("kari").patch(about, [set(["heading"], "Who we are")]);
    expect(await w.site.pending()).toEqual(["kari-1"]);
    expect(await w.site.draft(about)).toEqual({ heading: "Who we are" });
    expect(await w.site.page(about)).toEqual({ heading: "About us" });
  });

  test("the site's Publish ships every pending change, through Val's real save", async () => {
    const home = homePage();
    const about = aboutPage();
    const w = await world([home, about]);
    await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
    await w.onSite("per").patch(about, [set(["heading"], "Who we are")]);
    expect(await w.publishSite()).toMatchObject({
      status: "published",
      ids: ["kari-1", "per-1"],
    });
    expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
    expect(await w.site.page(about)).toEqual({ heading: "Who we are" });
    expect(await w.site.pending()).toEqual([]);
  });
});

// --- publishing over the site's pending changes -----------------------------------
//
// Nobody has published since the proposal started; editors have pending
// changes on the site. Publishing is never blocked by them. A pending change
// that conflicts with the merge moves into a proposal of its own, as a whole
// patch set; the rest stays.

describe("publishing a proposal over the site's pending changes", () => {
  test.failing(
    "1. different pages: Kari's pending change on About stays on the site",
    async () => {
      const home = homePage();
      const about = aboutPage();
      const w = await world([home, about]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(about, [set(["heading"], "Who we are")]);

      const published = await w.publish(summer);

      expect(published).toMatchObject({ status: "published", conflicts: [] });
      expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
      expect(await w.site.page(about)).toEqual({ heading: "About us" });
      expect(await w.site.pending()).toEqual(["kari-1"]);
      expect(await w.site.draft(about)).toEqual({ heading: "Who we are" });
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "merged" }),
      ]);
    },
  );

  test.failing(
    "2. same page, different fields: Kari's title stays, and the site's next Publish ships both",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["hero"], "b.png")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.page(home)).toEqual({
        title: "Sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
      expect(await w.site.pending()).toEqual(["kari-1"]);
      expect(await w.site.draft(home)).toEqual({
        title: "Spring sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
      expect(await w.proposals()).toHaveLength(1);

      await w.publishSite();
      expect(await w.site.page(home)).toEqual({
        title: "Spring sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
    },
  );

  test.failing(
    "3. same field: Kari's pending title moves into a proposal of her own",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);

      const published = await w.publish(summer);

      // Ola is not blocked, and has nothing to resolve.
      expect(published).toMatchObject({ status: "published", conflicts: [] });
      expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
      // Kari's change is no longer pending, where the site's next Publish
      // would have silently put "Spring sale" back over Ola's title.
      expect(await w.site.pending()).toEqual([]);
      expect(await w.site.draft(home)).toMatchObject({ title: "Summer sale" });
      // It is in a proposal Kari owns, which starts where the site was before
      // the merge.
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "merged" }),
        {
          name: MOVED,
          owners: ["kari"],
          startsAt: published.status === "published" ? published.before : "",
          changes: ["kari-1"],
          status: "open",
        },
      ]);
      // Its address shows her title, over the page as it was.
      expect(await w.proposalPage({ name: MOVED }, home)).toMatchObject({
        title: "Spring sale",
      });
    },
  );

  test.failing(
    "3b. same field, same value: nothing conflicts, and Kari's change stays",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Summer sale")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.pending()).toEqual(["kari-1"]);
      expect(await w.site.draft(home)).toMatchObject({ title: "Summer sale" });
      expect(await w.proposals()).toHaveLength(1);
    },
  );

  test.failing(
    "4. one change covering two fields, one in conflict: the whole change moves",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w
        .onSite("kari")
        .patch(home, [
          set(["title"], "Spring sale"),
          set(["subtitle"], "Fresh for spring"),
        ]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      // The subtitle goes with the title: a change moves whole.
      expect(await w.site.pending()).toEqual([]);
      expect(await w.site.draft(home)).toEqual({
        title: "Summer sale",
        subtitle: "Everything must go",
        hero: "a.png",
      });
      expect(await w.proposalPage({ name: MOVED }, home)).toEqual({
        title: "Spring sale",
        subtitle: "Fresh for spring",
        hero: "a.png",
      });
    },
  );

  test.failing(
    "5. a list both sides reshaped: Kari's added section moves",
    async () => {
      const sections = sectionsPage();
      const w = await world([sections]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(sections, [
        move(["sections", "2"], ["sections", "0"]),
      ]);
      await w
        .onSite("kari")
        .patch(sections, [add(["sections", "3"], { text: "Contact" })]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.page(sections)).toEqual({
        sections: [{ text: "Gallery" }, { text: "Hero" }, { text: "Text" }],
      });
      expect(await w.site.pending()).toEqual([]);
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign" }),
        expect.objectContaining({ name: MOVED, changes: ["kari-1"] }),
      ]);
    },
  );

  test.failing(
    "5b. a list neither side reshaped: edits to different items stay",
    async () => {
      const sections = sectionsPage();
      const w = await world([sections]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(sections, [set(["sections", "2", "text"], "Photos")]);
      await w
        .onSite("kari")
        .patch(sections, [set(["sections", "0", "text"], "Welcome")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.page(sections)).toEqual({
        sections: [{ text: "Hero" }, { text: "Text" }, { text: "Photos" }],
      });
      expect(await w.site.pending()).toEqual(["kari-1"]);
      expect(await w.site.draft(sections)).toEqual({
        sections: [{ text: "Welcome" }, { text: "Text" }, { text: "Photos" }],
      });
    },
  );

  test.failing(
    "5c. a pending insert into a list whose item the proposal edited moves",
    async () => {
      const sections = sectionsPage();
      const w = await world([sections]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(sections, [set(["sections", "1", "text"], "Story")]);
      // Inserted first: every item after it is at another position now.
      await w
        .onSite("kari")
        .patch(sections, [add(["sections", "0"], { text: "Banner" })]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.page(sections)).toEqual({
        sections: [{ text: "Hero" }, { text: "Story" }, { text: "Gallery" }],
      });
      expect(await w.site.pending()).toEqual([]);
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign" }),
        expect.objectContaining({ name: MOVED, changes: ["kari-1"] }),
      ]);
    },
  );

  test.failing(
    "6. a change written on top of a moving one moves with it, and both authors own the proposal",
    async () => {
      const sections = sectionsPage();
      const w = await world([sections]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(sections, [
        move(["sections", "2"], ["sections", "0"]),
      ]);
      await w
        .onSite("kari")
        .patch(sections, [add(["sections", "3"], { text: "Contact" })]);
      // Per edits the section Kari added: one patch set with hers.
      await w
        .onSite("per")
        .patch(sections, [set(["sections", "3", "text"], "Contact us")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.pending()).toEqual([]);
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign" }),
        expect.objectContaining({
          name: MOVED,
          owners: ["kari", "per"],
          changes: ["kari-1", "per-1"],
        }),
      ]);
      expect(await w.proposalPage({ name: MOVED }, sections)).toEqual({
        sections: [
          { text: "Hero" },
          { text: "Text" },
          { text: "Gallery" },
          { text: "Contact us" },
        ],
      });
    },
  );

  test.failing(
    "7. two editors with the same field pending: one proposal, owned by both",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.onSite("per").patch(home, [set(["title"], "Easter sale")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.pending()).toEqual([]);
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign" }),
        expect.objectContaining({
          name: MOVED,
          owners: ["kari", "per"],
          changes: ["kari-1", "per-1"],
        }),
      ]);
    },
  );

  test.failing(
    "only the conflicting patch set moves: a pending change to another field of the page stays",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.onSite("per").patch(home, [set(["hero"], "b.png")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.pending()).toEqual(["per-1"]);
      expect(await w.site.draft(home)).toEqual({
        title: "Summer sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign" }),
        expect.objectContaining({ name: MOVED, changes: ["kari-1"] }),
      ]);
    },
  );

  describe("a record: entries are merged by key", () => {
    test.failing("a pending change to another entry stays", async () => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await w
        .onSite("kari")
        .patch(products, [set(["product-2", "name"], "Armchair")]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.pending()).toEqual(["kari-1"]);
      expect(await w.site.draft(products)).toEqual({
        "product-1": { name: "Lamp", price: 120 },
        "product-2": { name: "Armchair", price: 200 },
      });
    });

    test.failing(
      "a pending change to the same field of the same entry moves",
      async () => {
        const products = productsPage();
        const w = await world([products]);
        const summer = w.openProposal("Summer campaign", { by: "ola" });
        await summer.patch(products, [set(["product-1", "price"], 120)]);
        await w
          .onSite("kari")
          .patch(products, [set(["product-1", "price"], 90)]);

        expect(await w.publish(summer)).toMatchObject({ status: "published" });

        expect(await w.site.pending()).toEqual([]);
        expect(await w.site.page(products)).toMatchObject({
          "product-1": { name: "Lamp", price: 120 },
        });
        expect(await w.proposals()).toEqual([
          expect.objectContaining({ name: "Summer campaign" }),
          expect.objectContaining({ name: MOVED, changes: ["kari-1"] }),
        ]);
      },
    );

    test.failing(
      "a pending change to another field of the same entry stays",
      async () => {
        const products = productsPage();
        const w = await world([products]);
        const summer = w.openProposal("Summer campaign", { by: "ola" });
        await summer.patch(products, [set(["product-1", "price"], 120)]);
        await w
          .onSite("kari")
          .patch(products, [set(["product-1", "name"], "Desk lamp")]);

        expect(await w.publish(summer)).toMatchObject({ status: "published" });

        expect(await w.site.pending()).toEqual(["kari-1"]);
        expect(await w.site.draft(products)).toMatchObject({
          "product-1": { name: "Desk lamp", price: 120 },
        });
      },
    );

    test.failing(
      "a pending removal of the entry the proposal edits moves",
      async () => {
        const products = productsPage();
        const w = await world([products]);
        const summer = w.openProposal("Summer campaign", { by: "ola" });
        await summer.patch(products, [set(["product-1", "price"], 120)]);
        await w.onSite("kari").patch(products, [remove(["product-1"])]);

        expect(await w.publish(summer)).toMatchObject({ status: "published" });

        expect(await w.site.pending()).toEqual([]);
        expect(await w.site.page(products)).toEqual({
          "product-1": { name: "Lamp", price: 120 },
          "product-2": { name: "Chair", price: 200 },
        });
        expect(await w.proposals()).toEqual([
          expect.objectContaining({ name: "Summer campaign" }),
          expect.objectContaining({ name: MOVED, changes: ["kari-1"] }),
        ]);
      },
    );

    test.failing("a pending new entry stays", async () => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await w
        .onSite("kari")
        .patch(products, [add(["product-3"], { name: "Rug", price: 50 })]);

      expect(await w.publish(summer)).toMatchObject({ status: "published" });

      expect(await w.site.pending()).toEqual(["kari-1"]);
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
// What Update from the site is for: the site has moved since the proposal
// started. Changes to other fields combine; the same field is a conflict, and
// nothing changes anywhere until it is resolved.

describe("publishing a proposal after the site published", () => {
  test.failing(
    "9. Kari published first: Ola's publish reports the conflict, and nothing changes",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publishSite();

      expect(await w.publish(summer)).toEqual({
        status: "conflicts",
        conflicts: [
          {
            moduleFilePath: "/home.val.ts",
            path: ["title"],
            base: "Sale",
            site: "Spring sale",
            proposal: "Summer sale",
          },
        ],
      });
      expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "open" }),
      ]);
    },
  );

  test.failing(
    "9, resolved keeping the proposal's title: Update, then Publish",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publishSite();

      expect(
        await w.update(summer, [
          { module: home, path: ["title"], keep: "proposal" },
        ]),
      ).toMatchObject({ status: "updated" });
      // The proposal now starts at the site's last commit, with its title.
      expect(await w.proposalPage(summer, home)).toMatchObject({
        title: "Summer sale",
      });
      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(home)).toMatchObject({ title: "Summer sale" });
    },
  );

  test.failing(
    "9, resolved keeping the site's title: the proposal publishes nothing over it",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [
        set(["title"], "Summer sale"),
        set(["hero"], "b.png"),
      ]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publishSite();

      expect(
        await w.update(summer, [
          { module: home, path: ["title"], keep: "site" },
        ]),
      ).toMatchObject({ status: "updated" });
      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(home)).toEqual({
        title: "Spring sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
    },
  );

  test.failing(
    "9, resolved with a value of its own, as AI or a developer writes one",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publishSite();

      await w.update(summer, [
        { module: home, path: ["title"], value: "Spring and summer sale" },
      ]);
      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(home)).toMatchObject({
        title: "Spring and summer sale",
      });
    },
  );

  test.failing(
    "an update without a resolution for every conflict changes nothing",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [
        set(["title"], "Summer sale"),
        set(["subtitle"], "Hot deals"),
      ]);
      await w
        .onSite("kari")
        .patch(home, [
          set(["title"], "Spring sale"),
          set(["subtitle"], "Fresh deals"),
        ]);
      await w.publishSite();

      const updated = await w.update(summer, [
        { module: home, path: ["title"], keep: "proposal" },
      ]);
      expect(updated).toEqual({
        status: "conflicts",
        conflicts: [expect.objectContaining({ path: ["subtitle"] })],
      });
      expect(await w.proposalPage(summer, home)).toEqual({
        title: "Summer sale",
        subtitle: "Hot deals",
        hero: "a.png",
      });
    },
  );

  test.failing(
    "the site published another field: they combine, with no update",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["hero"], "b.png")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publishSite();

      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(home)).toEqual({
        title: "Spring sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
    },
  );

  test.failing(
    "a record: the site added an entry, the proposal edited another, and both are kept",
    async () => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await w
        .onSite("kari")
        .patch(products, [add(["product-3"], { name: "Rug", price: 50 })]);
      await w.publishSite();

      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(products)).toEqual({
        "product-1": { name: "Lamp", price: 120 },
        "product-2": { name: "Chair", price: 200 },
        "product-3": { name: "Rug", price: 50 },
      });
    },
  );

  test.failing(
    "a record: the site removed the entry the proposal edited, which is a conflict",
    async () => {
      const products = productsPage();
      const w = await world([products]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(products, [set(["product-1", "price"], 120)]);
      await w.onSite("kari").patch(products, [remove(["product-1"])]);
      await w.publishSite();

      expect(await w.publish(summer)).toEqual({
        status: "conflicts",
        conflicts: [
          expect.objectContaining({
            moduleFilePath: "/products.val.ts",
            path: ["product-1"],
            site: undefined,
          }),
        ],
      });
    },
  );

  test.failing(
    "a list neither side reshaped: edits to different items combine",
    async () => {
      const sections = sectionsPage();
      const w = await world([sections]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(sections, [set(["sections", "2", "text"], "Photos")]);
      await w
        .onSite("kari")
        .patch(sections, [set(["sections", "0", "text"], "Welcome")]);
      await w.publishSite();

      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(sections)).toEqual({
        sections: [{ text: "Welcome" }, { text: "Text" }, { text: "Photos" }],
      });
    },
  );

  test.failing(
    "a list the site reshaped while the proposal edited an item: the list is the conflict",
    async () => {
      const sections = sectionsPage();
      const w = await world([sections]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(sections, [set(["sections", "1", "text"], "Story")]);
      await w
        .onSite("kari")
        .patch(sections, [add(["sections", "0"], { text: "Banner" })]);
      await w.publishSite();

      expect(await w.publish(summer)).toEqual({
        status: "conflicts",
        conflicts: [
          {
            moduleFilePath: "/sections.val.ts",
            path: ["sections"],
            base: [{ text: "Hero" }, { text: "Text" }, { text: "Gallery" }],
            site: [
              { text: "Banner" },
              { text: "Hero" },
              { text: "Text" },
              { text: "Gallery" },
            ],
            proposal: [
              { text: "Hero" },
              { text: "Story" },
              { text: "Gallery" },
            ],
          },
        ],
      });
    },
  );

  test.failing(
    "after an update, the site moving again on another field still combines",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publishSite();
      await w.update(summer, [
        { module: home, path: ["title"], keep: "proposal" },
      ]);
      await w.onSite("per").patch(home, [set(["subtitle"], "Hot deals")]);
      await w.publishSite();

      expect(await w.publish(summer)).toMatchObject({ status: "published" });
      expect(await w.site.page(home)).toEqual({
        title: "Summer sale",
        subtitle: "Hot deals",
        hero: "a.png",
      });
    },
  );
});

// --- the moved proposal -----------------------------------------------------------

describe("a proposal of moved changes", () => {
  test.failing(
    "3, continued: Kari's moved proposal shows the conflict with the title Ola published",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.publish(summer);

      const moved = w.proposal(MOVED);
      expect(await w.publish(moved)).toEqual({
        status: "conflicts",
        conflicts: [
          {
            moduleFilePath: "/home.val.ts",
            path: ["title"],
            base: "Sale",
            site: "Summer sale",
            proposal: "Spring sale",
          },
        ],
      });

      // Kari decides: her title.
      await w.update(moved, [
        { module: home, path: ["title"], keep: "proposal" },
      ]);
      expect(await w.publish(moved)).toMatchObject({ status: "published" });
      expect(await w.site.page(home)).toMatchObject({ title: "Spring sale" });
    },
  );

  test.failing(
    "a moved proposal and changes still pending on the site are independent",
    async () => {
      const home = homePage();
      const w = await world([home]);
      const summer = w.openProposal("Summer campaign", { by: "ola" });
      await summer.patch(home, [set(["title"], "Summer sale")]);
      await w.onSite("kari").patch(home, [set(["title"], "Spring sale")]);
      await w.onSite("per").patch(home, [set(["hero"], "b.png")]);
      await w.publish(summer);

      // Per's change publishes with the site, on its own.
      await w.publishSite();
      expect(await w.site.page(home)).toEqual({
        title: "Summer sale",
        subtitle: "Everything must go",
        hero: "b.png",
      });
      expect(await w.proposals()).toEqual([
        expect.objectContaining({ name: "Summer campaign", status: "merged" }),
        expect.objectContaining({
          name: MOVED,
          status: "open",
          changes: ["kari-1"],
        }),
      ]);
    },
  );
});

// --- not modelled yet ------------------------------------------------------------

describe("not modelled yet", () => {
  test.todo(
    "8. a field the proposal's schema removed, with a pending change to it on the site: it moves (needs schema changes in the world)",
  );
  test.todo(
    "10. Kari is told in the Studio that her change moved, with Open the proposal (a Studio test)",
  );
  test.todo(
    "a change written on the site after Val planned the merge: content refuses the stale plan, and Val plans again (needs the plan and the seal apart in the world)",
  );
});
