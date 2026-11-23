import { diffSource, recordEntryChanges } from "./diffSource";
import { bold, h2, p, PAGE, pageSchema as schema, site } from "./pageFixture";
import {
  listItemChange,
  type FieldDiff,
  type ListItemDiff,
  type RichTextBlockDiff,
  type ValueDiff,
} from "./types";

const [hero, faq, quote, logos] = site.sections;
/** The questions of the FAQ section, which is the second. */
const faqItems = faq.type === "faq" ? faq.items : [];

/** The page with some of its fields changed. */
function diff(changed: Record<string, unknown>): FieldDiff[] {
  return diffSource({
    moduleFilePath: PAGE,
    schema,
    before: site,
    after: { ...site, ...changed },
  });
}

function only(fields: FieldDiff[]): FieldDiff {
  expect(fields).toHaveLength(1);
  return fields[0];
}

function listOf(value: ValueDiff): ListItemDiff[] {
  if (value.kind !== "list") throw new Error(`a ${value.kind}, not a list`);
  return value.items;
}

/** A list as one line per item: where it is, what it is called, what happened. */
function readList(value: ValueDiff): string[] {
  return listOf(value).map(
    (item) =>
      `${item.at ?? "-"} ${item.title}: ${listItemChange(item)}${
        item.moved ? ` from ${item.was}` : ""
      }`,
  );
}

function blocksOf(value: ValueDiff): RichTextBlockDiff[] {
  if (value.kind !== "richtext") {
    throw new Error(`a ${value.kind}, not a rich text`);
  }
  return value.blocks;
}

test("nothing changed is nothing to show", () => {
  expect(diff({})).toEqual([]);
});

test("the same value with its keys in another order is no change", () => {
  expect(diff({ seo: { index: false, title: "Hello | Val" } })).toEqual([]);
});

describe("a field", () => {
  test("is named by where it is, and identified by its source path", () => {
    expect(diff({ title: "Content that ships with the code" })).toEqual([
      {
        id: `${PAGE}?p="title"`,
        label: "title",
        value: {
          kind: "text",
          before: "Content that ships with your code",
          after: "Content that ships with the code",
        },
      },
    ]);
  });

  test("inside an object is one row, named through the object", () => {
    const field = only(
      diff({ seo: { title: "Hello, spring | Val", index: false } }),
    );
    expect(field.label).toBe("seo › title");
    expect(field.id).toBe(`${PAGE}?p="seo"."title"`);
  });

  /** Half of a date struck out says less than the two dates. */
  test("that is read whole is not diffed word by word", () => {
    const fields = diff({
      published: true,
      date: "2026-11-17",
      status: "live",
    });
    expect(fields.map((field) => [field.label, field.value])).toEqual([
      ["published", { kind: "scalar", before: "false", after: "true" }],
      ["date", { kind: "scalar", before: "2026-11-03", after: "2026-11-17" }],
      ["status", { kind: "scalar", before: "draft", after: "live" }],
    ]);
  });

  test("come in the schema's order, which is the editor's", () => {
    expect(
      diff({ status: "live", title: "New", published: true }).map(
        (field) => field.label,
      ),
    ).toEqual(["title", "published", "status"]);
  });

  test("the schema does not know is still a change", () => {
    const field = only(diff({ legacy: "kept from an older schema" }));
    expect(field.label).toBe("legacy");
    expect(field.value).toEqual({
      kind: "text",
      before: null,
      after: "kept from an older schema",
    });
  });

  test("that does not fit its schema is still a change", () => {
    const field = only(diff({ title: 42 }));
    expect(field.value).toEqual({
      kind: "scalar",
      before: "Content that ships with your code",
      after: "42",
    });
  });
});

describe("an array of objects", () => {
  const added = {
    type: "quote",
    title: "Testimonials",
    text: "It took an afternoon.",
    author: "Kari",
  };

  /**
   * `architecture/known-issues.md`, "An array of OBJECTS is still diffed by
   * index": one insertion read as every later item changing.
   */
  test("an insertion is one added item", () => {
    const field = only(diff({ sections: [hero, added, faq, quote, logos] }));
    expect(field.label).toBe("sections");
    expect(readList(field.value)).toEqual([
      "1 Content that ships with your code: unchanged",
      "2 Testimonials: added",
      "3 Questions: unchanged",
      "4 What teams say: unchanged",
      "5 Customer logos: unchanged",
    ]);
  });

  test("a reorder moves the item that moved, and no other", () => {
    const field = only(diff({ sections: [logos, hero, faq, quote] }));
    expect(readList(field.value)).toEqual([
      "1 Customer logos: moved from 4",
      "2 Content that ships with your code: unchanged",
      "3 Questions: unchanged",
      "4 What teams say: unchanged",
    ]);
  });

  test("a removal is shown where the item was", () => {
    const field = only(diff({ sections: [hero, quote, logos] }));
    expect(readList(field.value)).toEqual([
      "1 Content that ships with your code: unchanged",
      "- Questions: removed",
      "2 What teams say: unchanged",
      "3 Customer logos: unchanged",
    ]);
  });

  test("an item edited in place is that item, with its fields named from it", () => {
    const field = only(
      diff({
        sections: [
          hero,
          faq,
          { ...quote, text: "Editors never open git." },
          logos,
        ],
      }),
    );
    const items = listOf(field.value);
    expect(items.map(listItemChange)).toEqual([
      "unchanged",
      "unchanged",
      "changed",
      "unchanged",
    ]);
    expect(items[2].fields).toEqual([
      {
        id: `${PAGE}?p="sections".2."text"`,
        label: "text",
        value: {
          kind: "text",
          before: "Editors never see git.",
          after: "Editors never open git.",
        },
      },
    ]);
  });

  test("an item can move and be edited", () => {
    const field = only(
      diff({
        sections: [{ ...logos, author: "Linus Berg" }, hero, faq, quote],
      }),
    );
    const [first] = listOf(field.value);
    expect(listItemChange(first)).toBe("moved-changed");
    expect(first.was).toBe(4);
    expect(first.fields?.map((each) => each.label)).toEqual(["author"]);
  });

  test("a list inside an item is a list of its own", () => {
    const field = only(
      diff({
        sections: [
          hero,
          {
            ...faq,
            items: [
              faqItems[0],
              { question: "Can I self-host?", answer: "Yes." },
              faqItems[1],
            ],
          },
          quote,
          logos,
        ],
      }),
    );
    const inner = only(listOf(field.value)[1].fields ?? []);
    expect(inner.label).toBe("items");
    expect(readList(inner.value)).toEqual([
      "1 How often do you ship?: unchanged",
      "2 Can I self-host?: added",
      "3 Is there a free plan?: unchanged",
    ]);
  });

  /** Two items of different variants are never one item, however alike. */
  test("an item replaced by one of another variant is an addition and a removal", () => {
    const field = only(
      diff({
        sections: [
          hero,
          { type: "quote", title: "Questions", text: "Ask us.", author: "Ada" },
          quote,
          logos,
        ],
      }),
    );
    expect(readList(field.value)).toEqual([
      "1 Content that ships with your code: unchanged",
      "2 Questions: added",
      "- Questions: removed",
      "3 What teams say: unchanged",
      "4 Customer logos: unchanged",
    ]);
  });

  test("an added item's contents are there to open", () => {
    const field = only(diff({ sections: [hero, faq, quote, logos, added] }));
    const last = listOf(field.value)[4];
    expect(last.detail?.map((each) => [each.label, each.value])).toEqual([
      ["type", { kind: "scalar", before: null, after: "quote" }],
      ["title", { kind: "text", before: null, after: "Testimonials" }],
      ["text", { kind: "text", before: null, after: "It took an afternoon." }],
      ["author", { kind: "text", before: null, after: "Kari" }],
    ]);
  });

  test("an item is called what the caller says it is called", () => {
    const fields = diffSource(
      {
        moduleFilePath: PAGE,
        schema,
        before: site,
        after: { ...site, sections: [hero, added, faq, quote, logos] },
      },
      {
        titleOf: (sourcePath) =>
          sourcePath === `${PAGE}?p="sections".1` ? "A preview" : null,
      },
    );
    expect(listOf(only(fields).value)[1].title).toBe("A preview");
  });
});

describe("an array of strings", () => {
  test("is matched by what the strings are", () => {
    const field = only(diff({ tags: ["react", "cms", "next", "typescript"] }));
    expect(readList(field.value)).toEqual([
      "1 react: moved from 3",
      "2 cms: unchanged",
      "3 next: added",
      "4 typescript: unchanged",
    ]);
  });

  test("a string rewritten where it stood is that string, changed", () => {
    const field = only(diff({ tags: ["cms", "javascript", "react"] }));
    const items = listOf(field.value);
    expect(readList(field.value)).toEqual([
      "1 cms: unchanged",
      "2 javascript: changed",
      "3 react: unchanged",
    ]);
    expect(items[1].fields).toEqual([
      {
        id: `${PAGE}?p="tags".1`,
        label: "",
        value: { kind: "text", before: "typescript", after: "javascript" },
      },
    ]);
  });
});

describe("a record", () => {
  test("is a list by key, with no places and no moves", () => {
    const field = only(
      diff({
        people: {
          linus: site.people.linus,
          ada: {
            ...site.people.ada,
            bio: "Wrote the first published program.",
          },
          kari: { name: "Kari Nordmann", bio: "Edits the blog." },
        },
      }),
    );
    expect(field.value).toMatchObject({ kind: "list", keyed: true });
    expect(
      listOf(field.value).map((item) => [item.key, listItemChange(item)]),
    ).toEqual([
      ["linus", "unchanged"],
      ["ada", "changed"],
      ["kari", "added"],
    ]);
  });

  test("a key that changed is a rename, not a removal and an addition", () => {
    const field = only(
      diff({
        people: { ada: site.people.ada, "linus-berg": site.people.linus },
      }),
    );
    const renamed = listOf(field.value)[1];
    expect(listItemChange(renamed)).toBe("renamed");
    expect(renamed).toMatchObject({ key: "linus-berg", renamedFrom: "linus" });
  });

  test("an entry can be renamed and edited", () => {
    const field = only(
      diff({
        people: {
          ada: site.people.ada,
          "linus-berg": { ...site.people.linus, bio: "Maintains the builds." },
        },
      }),
    );
    const renamed = listOf(field.value)[1];
    expect(listItemChange(renamed)).toBe("renamed-changed");
    expect(renamed.fields?.map((each) => each.label)).toEqual(["bio"]);
  });

  test("two entries that are merely alike are not a rename", () => {
    const field = only(
      diff({
        people: {
          ada: site.people.ada,
          kari: { name: "Kari Nordmann", bio: "Maintains the build." },
        },
      }),
    );
    expect(
      listOf(field.value).map((item) => [item.key, listItemChange(item)]),
    ).toEqual([
      ["ada", "unchanged"],
      ["kari", "added"],
      ["linus", "removed"],
    ]);
  });
});

describe("recordEntryChanges", () => {
  /** What a caller that lists PAGES asks: which page was added, which moved. */
  test("says what happened to each entry", () => {
    const before = {
      "/": { title: "Home" },
      "/about-us": { title: "About us", body: "We are forty people." },
      "/old": { title: "Old" },
    };
    const after = {
      "/": { title: "Home, spring" },
      "/about": { title: "About us", body: "We are forty people." },
      "/pricing": { title: "Pricing" },
    };
    expect(
      recordEntryChanges(before, after).map((entry) => [
        entry.key,
        entry.change,
        entry.renamedFrom,
      ]),
    ).toEqual([
      ["/", "changed", undefined],
      ["/about", "renamed", "/about-us"],
      ["/pricing", "added", undefined],
      ["/old", "removed", undefined],
    ]);
  });
});

describe("a rich text", () => {
  test("is its blocks: what did not change is counted, not shown", () => {
    const field = only(
      diff({
        body: [
          site.body[0],
          p("Editors never open git. They see a page and a Publish button."),
          site.body[2],
        ],
      }),
    );
    expect(blocksOf(field.value)).toEqual([
      { kind: "unchanged", count: 1 },
      {
        kind: "block",
        id: `${PAGE}?p="body"#block:1`,
        tag: "p",
        change: "changed",
        before: "Editors never see git. They see a page and a Publish button.",
        after: "Editors never open git. They see a page and a Publish button.",
      },
      { kind: "unchanged", count: 1 },
    ]);
  });

  test("a block added, a block removed and a block moved", () => {
    const field = only(
      diff({ body: [site.body[2], h2("Pricing"), site.body[0]] }),
    );
    expect(
      blocksOf(field.value).map((block) =>
        block.kind === "unchanged"
          ? `${block.count} unchanged`
          : `${block.change} ${block.tag}${
              block.movedBy !== undefined ? ` by ${block.movedBy}` : ""
            }`,
      ),
    ).toEqual(["moved p by -2", "added h2", "1 unchanged", "removed p"]);
  });

  /** The words are the same, so the text alone would show nothing. */
  test("a change of formatting only says so", () => {
    const field = only(
      diff({
        body: [
          site.body[0],
          site.body[1],
          p("It works with ", bold("the framework"), " you already use."),
        ],
      }),
    );
    expect(blocksOf(field.value)[1]).toMatchObject({
      change: "changed",
      before: "It works with the framework you already use.",
      after: "It works with the framework you already use.",
      note: "Formatting changed",
    });
  });

  test("a list is its items", () => {
    const list = (...texts: string[]) => ({
      tag: "ul",
      children: texts.map((text) => ({ tag: "li", children: [p(text)] })),
    });
    const fields = diffSource({
      moduleFilePath: PAGE,
      schema,
      before: { ...site, body: [list("One", "Two")] },
      after: { ...site, body: [list("One", "Two", "Three")] },
    });
    expect(blocksOf(only(fields).value)).toEqual([
      { kind: "unchanged", count: 2 },
      {
        kind: "block",
        id: `${PAGE}?p="body"#block:2`,
        tag: "li",
        change: "added",
        after: "Three",
      },
    ]);
  });
});

describe("an image", () => {
  const replaced = {
    path: "/public/val/office_b71c4.webp",
    width: 1600,
    height: 800,
    mimeType: "image/webp",
    alt: "The team at work",
  };

  test("replaced is the two files, and not also their dimensions", () => {
    expect(diff({ hero: replaced })).toEqual([
      {
        id: `${PAGE}?p="hero"`,
        label: "hero",
        value: {
          kind: "media",
          before: {
            url: "/val/team_3f9a1.webp",
            name: "team_3f9a1.webp",
            note: "1200 × 600",
          },
          after: {
            url: "/val/office_b71c4.webp",
            name: "office_b71c4.webp",
            note: "1600 × 800",
          },
        },
      },
    ]);
  });

  test("whose text changed is the text, and the file is not mentioned", () => {
    const field = only(
      diff({ hero: { ...site.hero, alt: "The team at the office" } }),
    );
    expect(field.label).toBe("hero › alt");
    expect(field.value).toEqual({
      kind: "text",
      before: "The team at work",
      after: "The team at the office",
    });
  });

  test("replaced and described again is both", () => {
    expect(
      diff({ hero: { ...replaced, alt: "The office" } }).map(
        (field) => field.label,
      ),
    ).toEqual(["hero", "hero › alt"]);
  });

  test("removed has nothing after", () => {
    const field = only(diff({ hero: null }));
    expect(field.value).toMatchObject({ kind: "media", after: null });
  });

  test("a focal point is said as a place", () => {
    const field = only(
      diff({ hero: { ...site.hero, hotspot: { x: 0.5, y: 0.3 } } }),
    );
    expect(field.label).toBe("hero › hotspot");
    expect(field.value).toEqual({
      kind: "scalar",
      before: null,
      after: "50% 30%",
    });
  });

  /** A pending upload is served by its patch, which only the Studio knows. */
  test("is served from where the caller says", () => {
    const fields = diffSource(
      {
        moduleFilePath: PAGE,
        schema,
        before: site,
        after: { ...site, hero: replaced },
      },
      { mediaUrl: (path, side) => `/files${path}?side=${side}` },
    );
    expect(only(fields).value).toMatchObject({
      before: { url: "/files/public/val/team_3f9a1.webp?side=before" },
      after: { url: "/files/public/val/office_b71c4.webp?side=after" },
    });
  });
});

describe("a page of a router", () => {
  test("is diffed at its own path, and its fields are named from the page", () => {
    const fields = diffSource({
      moduleFilePath: PAGE,
      schema: schema?.type === "object" ? schema.items.seo : undefined,
      before: { title: "Hello | Val", index: false },
      after: { title: "Hello | Val", index: true },
      path: ["/blogs/hello"],
    });
    expect(only(fields)).toMatchObject({
      id: `${PAGE}?p="/blogs/hello"."index"`,
      label: "index",
    });
  });
});
